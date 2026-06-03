import {
  TemplateEntityBuilder,
  type CreateMasterTemplateInput,
} from '../builder/template-entity.builder';
import {
  toMasterFullRecord,
  toTemplateSummary,
  toVersionSummary,
} from '../mappers/template-http.dto';
import type {
  GetMasterVersionsParams,
  GetMasterVersionsResult,
  VersionResolveStrategy,
} from '../models/api/get-master-versions.types';
import type { ListMasterTemplatesParams, ListMasterTemplatesResult } from '../models/api/list-master.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import {
  listMasterNextToken,
  TemplateRepository,
} from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import {
  normalizeVersionToSk,
  pickHighestVersionRow,
  templateNotFoundError,
  templateVersionIdToSk,
} from '../utils/template.utils';
import { TemplateMasterOpsService } from './template-master-ops.service';
import { CompatibleTemplatesService } from './compatible-templates.service';
import type { ListCompatibleTemplatesParams } from '../models/api/compatible-templates.types';
import type {
  SaveMasterTemplateParams,
  TransitionMasterStatusParams,
  UpdateMasterVersionParams,
} from '../models/api/master-version-ops.types';

export class TemplateService {
  private readonly repo = new TemplateRepository();
  private readonly masterOps = new TemplateMasterOpsService(this.repo);
  private readonly compatibleSvc = new CompatibleTemplatesService(this.repo);

  async createMasterTemplate(
    input: CreateMasterTemplateInput,
    actorUserId?: string,
  ): Promise<{ record: TemplateDdbRecord }> {
    try {
      const templateId = TemplateEntityBuilder.normalizeTemplateId(input.templateCode);
      const existing = await this.repo.getMasterMeta(templateId);
      if (existing) {
        const conflict = new Error('Master template already exists') as Error & {
          statusCode: number;
          code: string;
        };
        conflict.statusCode = 409;
        conflict.code = 'CONFLICT';
        throw conflict;
      }

      const record = await this.repo.createMasterTemplate({
        ...input,
        createdBy: input.createdBy ?? actorUserId,
      });
      return { record };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async listMasterTemplates(params: ListMasterTemplatesParams): Promise<ListMasterTemplatesResult> {
    try {
      const { items, lastEvaluatedKey } = await this.repo.listMasterTemplates(params);
      return {
        items: items.map(toMasterFullRecord),
        nextToken: listMasterNextToken(lastEvaluatedKey),
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async getMasterTemplateVersions(params: GetMasterVersionsParams): Promise<GetMasterVersionsResult> {
    try {
      const meta = await this.repo.getMasterMeta(params.templateId);
      if (!meta) {
        templateNotFoundError();
      }

      const versionQuery = params.version?.trim();
      if (!versionQuery) {
        const { items, lastEvaluatedKey } = await this.repo.listMasterVersions(params);
        return {
          mode: 'list',
          items: items.map(toVersionSummary),
          nextToken: listMasterNextToken(lastEvaluatedKey),
        };
      }

      if (versionQuery.toLowerCase() === 'latest') {
        const record = await this.resolveLatestMasterVersion(
          params.templateId,
          meta.meta,
          params.resolve ?? 'ACTIVE',
        );
        if (!record) {
          templateNotFoundError('Master template version not found');
        }
        return { mode: 'single', record };
      }

      const versionSk = normalizeVersionToSk(versionQuery);
      const record = await this.repo.getMasterVersion(params.templateId, versionSk);
      if (!record) {
        templateNotFoundError('Master template version not found');
      }
      return { mode: 'single', record };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private async resolveLatestMasterVersion(
    templateId: string,
    meta: TemplateMeta,
    resolve: VersionResolveStrategy,
  ): Promise<TemplateDdbRecord | null> {
    if (resolve === 'ACTIVE') {
      const sk = templateVersionIdToSk(meta.templateVersionId);
      if (sk) {
        const active = await this.repo.getMasterVersion(templateId, sk);
        if (active) return active;
      }
    }

    const { items } = await this.repo.queryMasterVersionsPage(templateId, { limit: 100 });
    if (items.length === 0) return null;

    if (resolve === 'LATEST_PUBLISHED') {
      const published = items.filter((r) => r.meta?.status === TEMPLATE_STATUS.PUBLISHED);
      return pickHighestVersionRow(published.length ? published : items);
    }

    return pickHighestVersionRow(items);
  }

  async updateMasterTemplateVersion(params: UpdateMasterVersionParams) {
    return this.masterOps.updateMasterTemplateVersion(params);
  }

  async transitionMasterTemplateStatus(params: TransitionMasterStatusParams) {
    return this.masterOps.transitionMasterTemplateStatus(params);
  }

  /**
   * Single master write API: optional `lifecycleAction` (PUBLISH, SUBMIT_REVIEW, …) or content update.
   * Resolves the current head `templateVersionId` — clients do not pass version in the URL.
   */
  async saveMasterTemplate(params: SaveMasterTemplateParams): Promise<TemplateDdbRecord> {
    try {
      const metaRow = await this.repo.getMasterMeta(params.templateId);
      if (!metaRow) {
        templateNotFoundError();
      }

      const versionId =
        params.templateVersionId?.trim() || metaRow.meta.templateVersionId;
      if (!versionId?.trim()) {
        templateNotFoundError('Master template version not found');
      }

      const lifecycleAction =
        typeof params.body.lifecycleAction === 'string'
          ? params.body.lifecycleAction.trim()
          : typeof params.body.action === 'string'
            ? params.body.action.trim()
            : '';

      if (lifecycleAction) {
        return await this.transitionMasterTemplateStatus({
          templateId: params.templateId,
          versionId,
          body: {
            action: lifecycleAction,
            comment:
              typeof params.body.comment === 'string' ? params.body.comment : null,
            reason:
              typeof params.body.reason === 'string' ? params.body.reason : null,
          },
          actorUserId: params.actorUserId,
        });
      }

      return await this.updateMasterTemplateVersion({
        templateId: params.templateId,
        versionId,
        body: params.body,
        actorUserId: params.actorUserId,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async listCompatibleTemplates(params: ListCompatibleTemplatesParams) {
    return this.compatibleSvc.listCompatibleTemplates(params);
  }

  toCreateResponse(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
