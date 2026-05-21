import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import {
  toOrgListItem,
  toOrgVersionSummary,
  toTemplateSummary,
} from '../mappers/template-http.dto';
import type {
  CloneOrgTemplateParams,
  GetOrgVersionsParams,
  GetOrgVersionsResult,
  ListOrgTemplatesParams,
  ListOrgTemplatesResult,
} from '../models/api/org-template.types';
import type { VersionResolveStrategy } from '../models/api/get-master-versions.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import { OrgTemplateRepository, listOrgNextToken } from '../repositories/org-template.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import {
  normalizeVersionToSk,
  pickHighestVersionRow,
  templateConflictError,
  templateNotFoundError,
  templateVersionIdToSk,
} from '../utils/template.utils';

export class OrgTemplateService {
  constructor(
    private readonly orgRepo = new OrgTemplateRepository(),
    private readonly masterRepo = new TemplateRepository(),
  ) {}

  async cloneTemplateVersion(params: CloneOrgTemplateParams): Promise<TemplateDdbRecord> {
    try {
      const versionSk = normalizeVersionToSk(params.masterVersionId);
      const masterVersion = await this.masterRepo.getMasterVersion(
        params.masterTemplateId,
        versionSk,
      );
      if (!masterVersion) {
        templateNotFoundError('Master template version not found');
      }

      const status = masterVersion.meta?.status;
      if (status !== TEMPLATE_STATUS.PUBLISHED) {
        templateConflictError(
          `Clone requires a PUBLISHED master version; current status is ${status ?? 'UNKNOWN'}`,
        );
      }

      const inheritLinks = params.body?.inheritLinks !== false;
      const newTemplateName =
        params.body?.newTemplateName?.trim() ||
        `${masterVersion.meta.templateName ?? params.masterTemplateId} (${params.organizationId})`;

      const ctx = OrgTemplateEntityBuilder.buildCloneContext(
        params.organizationId,
        params.masterTemplateId,
        masterVersion.meta.templateVersionId,
        newTemplateName,
        inheritLinks,
      );

      const existing = await this.orgRepo.getOrgMeta(params.organizationId, ctx.newTemplateId);
      if (existing) {
        templateConflictError(
          `Org template ${ctx.newTemplateId} already exists for organization ${params.organizationId}`,
        );
      }

      const meta = OrgTemplateEntityBuilder.buildOrgMetaFromMaster(
        masterVersion,
        ctx,
        params.actorUserId,
      );
      const metaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(
        meta,
        params.organizationId,
        ctx.newTemplateId,
      );
      const versionRow = OrgTemplateEntityBuilder.buildOrgVersionRow(meta, ctx, masterVersion);

      await this.orgRepo.createOrgTemplate(metaRow, versionRow);
      return versionRow;
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async listOrgTemplates(params: ListOrgTemplatesParams): Promise<ListOrgTemplatesResult> {
    try {
      const { items, lastEvaluatedKey } = await this.orgRepo.listOrgTemplates(params);
      return {
        items: items.map((r) => toOrgListItem(r, params.organizationId)),
        nextToken: listOrgNextToken(lastEvaluatedKey),
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async getOrgTemplateVersions(params: GetOrgVersionsParams): Promise<GetOrgVersionsResult> {
    try {
      const versionQuery = params.version?.trim();

      if (versionQuery?.toLowerCase() === 'meta') {
        const metaRow = await this.orgRepo.getOrgMeta(params.organizationId, params.templateId);
        if (!metaRow) {
          templateNotFoundError('Org template not found');
        }
        return { mode: 'meta', record: metaRow };
      }

      const meta = await this.orgRepo.getOrgMeta(params.organizationId, params.templateId);
      if (!meta) {
        templateNotFoundError('Org template not found');
      }

      if (!versionQuery) {
        const { items, lastEvaluatedKey } = await this.orgRepo.listOrgVersions({
          organizationId: params.organizationId,
          templateId: params.templateId,
          status: params.status,
          nextToken: params.nextToken,
          limit: params.limit ?? 25,
        });
        return {
          mode: 'list',
          items: items.map((r) => toOrgVersionSummary(r, params.organizationId)),
          nextToken: listOrgNextToken(lastEvaluatedKey),
        };
      }

      if (versionQuery.toLowerCase() === 'latest') {
        const record = await this.resolveLatestOrgVersion(
          params.organizationId,
          params.templateId,
          meta.meta,
          params.resolve ?? 'ACTIVE',
        );
        if (!record) {
          templateNotFoundError('Org template version not found');
        }
        return { mode: 'single', record };
      }

      const versionSk = normalizeVersionToSk(versionQuery);
      const record = await this.orgRepo.getOrgVersion(
        params.organizationId,
        params.templateId,
        versionSk,
      );
      if (!record) {
        templateNotFoundError('Org template version not found');
      }
      return { mode: 'single', record };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private async resolveLatestOrgVersion(
    organizationId: string,
    templateId: string,
    meta: TemplateMeta,
    resolve: VersionResolveStrategy,
  ): Promise<TemplateDdbRecord | null> {
    if (resolve === 'ACTIVE') {
      const sk = templateVersionIdToSk(meta.templateVersionId);
      if (sk) {
        const active = await this.orgRepo.getOrgVersion(organizationId, templateId, sk);
        if (active) return active;
      }
    }

    const { items } = await this.orgRepo.queryOrgVersionsPage(organizationId, templateId, {
      limit: 100,
    });
    if (items.length === 0) return null;

    if (resolve === 'LATEST_PUBLISHED') {
      const published = items.filter((r) => r.meta?.status === TEMPLATE_STATUS.PUBLISHED);
      return pickHighestVersionRow(published.length ? published : items);
    }

    return pickHighestVersionRow(items);
  }

  toCreateResponse(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
