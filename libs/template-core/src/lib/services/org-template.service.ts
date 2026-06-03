import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import type {
  ListOrgCatalogParams,
  ListOrgCatalogResult,
  OrgCatalogFilterOptions,
  OrgEnableCatalogItem,
} from '../models/api/list-org-catalog.types';
import {
  type MasterTemplateListItem,
  toOrgListItem,
  toOrgVersionSummary,
  toTemplateSummary,
} from '../mappers/template-http.dto';
import type {
  CloneOrgTemplateParams,
  DeriveOrgTemplateResult,
  GetOrgVersionsParams,
  GetOrgVersionsResult,
  ListOrgTemplatesParams,
  ListOrgTemplatesResult,
} from '../models/api/org-template.types';
import type { VersionResolveStrategy } from '../models/api/get-master-versions.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { TEMPLATE_STATUS } from '../constants/template.constants';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgTemplateRepository, listOrgNextToken } from '../repositories/org-template.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { TemplateService } from './template.service';
import { firstString } from '../utils/template.utils';
import { OrgTemplateOpsService } from './org-template-ops.service';
import type {
  TransitionOrgStatusParams,
  UpdateOrgTemplateVersionParams,
} from '../models/api/org-update.types';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import {
  normalizeVersionToSk,
  pickHighestVersionRow,
  templateConflictError,
  templateNotFoundError,
  templateVersionIdToSk,
} from '../utils/template.utils';

function fieldValuesOf(record: { fieldValues?: unknown }): Record<string, unknown> {
  const fv = record.fieldValues;
  return fv && typeof fv === 'object' && !Array.isArray(fv) ? (fv as Record<string, unknown>) : {};
}

function mapOrgCatalogItem(
  row: MasterTemplateListItem,
  enabledVersionIds: Set<string>,
): OrgEnableCatalogItem {
  const fv = fieldValuesOf(row);
  return {
    ...row,
    categoryCode: firstString(fv.categoryCode),
    conditionCode: firstString(fv.conditionCode),
    templateEnabled: enabledVersionIds.has(row.templateVersionId),
    countries: row.countries,
  };
}

function buildOrgCatalogFilterOptions(items: OrgEnableCatalogItem[]): OrgCatalogFilterOptions {
  const category = new Map<string, string>();
  const templateType = new Map<string, string>();
  const templateName = new Map<string, string>();
  const country = new Map<string, string>();
  const condition = new Map<string, string>();

  for (const item of items) {
    if (item.categoryCode) category.set(item.categoryCode.toUpperCase(), item.categoryCode);
    if (item.templateType) templateType.set(item.templateType.toUpperCase(), item.templateType);
    if (item.templateName) templateName.set(item.templateName, item.templateName);
    if (item.conditionCode) condition.set(item.conditionCode.toUpperCase(), item.conditionCode);
    for (const c of item.countries ?? []) {
      if (typeof c === 'string' && c.trim()) country.set(c.toUpperCase(), c);
    }
  }

  const toOpts = (m: Map<string, string>) =>
    [...m.values()].map((value) => ({ label: value, value })).sort((a, b) => a.label.localeCompare(b.label));

  return {
    status: [
      { label: 'Draft', value: 'DRAFT' },
      { label: 'Published', value: 'PUBLISHED' },
    ],
    scope: [
      { label: 'Private', value: 'PRIVATE' },
      { label: 'Organization', value: 'ORGANIZATION' },
      { label: 'Public', value: 'PUBLIC' },
    ],
    condition: toOpts(condition),
    category: toOpts(category),
    templateType: toOpts(templateType),
    templateName: toOpts(templateName),
    country: toOpts(country),
  };
}

export class OrgTemplateService {
  private readonly orgOps = new OrgTemplateOpsService();
  private readonly masterSvc = new TemplateService();

  constructor(
    private readonly orgRepo = new OrgTemplateRepository(),
    private readonly masterRepo = new TemplateRepository(),
    private readonly enablementRepo = new EnablementRepository(),
  ) {}

  private async resolvePublishedMasterVersion(
    masterTemplateId: string,
  ): Promise<TemplateDdbRecord> {
    const metaRow = await this.masterRepo.getMasterMeta(masterTemplateId);
    if (!metaRow) {
      templateNotFoundError('Master template not found');
    }

    const { items } = await this.masterRepo.queryMasterVersionsPage(masterTemplateId, {
      limit: 100,
    });
    const published = items.filter((r) => r.meta?.status === TEMPLATE_STATUS.PUBLISHED);
    const row = pickHighestVersionRow(published);
    if (!row) {
      templateConflictError(
        'Derive requires a PUBLISHED master version. Publish the master first, or pass sourceVersionId explicitly.',
      );
    }
    return row;
  }

  async cloneTemplateVersion(params: CloneOrgTemplateParams): Promise<DeriveOrgTemplateResult> {
    try {
      const masterTemplateId = TemplateEntityBuilder.normalizeTemplateId(params.masterTemplateId);
      const masterVersionId = params.masterVersionId?.trim();

      let masterVersion: TemplateDdbRecord | null = null;
      if (masterVersionId) {
        const versionSk = normalizeVersionToSk(masterVersionId);
        masterVersion = await this.masterRepo.getMasterVersion(masterTemplateId, versionSk);
        if (!masterVersion) {
          templateNotFoundError('Master template version not found');
        }
      } else {
        masterVersion = await this.resolvePublishedMasterVersion(masterTemplateId);
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
        params.body?.templateName?.trim() ||
        `${masterVersion.meta.templateName ?? params.masterTemplateId} (${params.organizationId})`;

      const ctx = OrgTemplateEntityBuilder.buildCloneContext(
        params.organizationId,
        masterTemplateId,
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

      const derivationType = params.body?.derivationType ?? 'ENABLE';
      const templateEnabled = derivationType === 'ENABLE';
      if (templateEnabled) {
        await this.createEnablementForOrg(params.organizationId, masterVersion);
      }

      return { record: versionRow, masterVersion, templateEnabled };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private async createEnablementForOrg(
    organizationId: string,
    masterVersion: TemplateDdbRecord,
  ): Promise<void> {
    const masterTemplateVersionId = masterVersion.meta.templateVersionId;
    const existing = await this.enablementRepo.findByOrgAndMasterVersion(
      organizationId,
      masterTemplateVersionId,
    );
    if (existing) return;

    const nowIso = new Date().toISOString();
    const enablementId = EnablementEntityBuilder.buildEnablementId(organizationId);
    const meta = EnablementEntityBuilder.buildMeta(
      {
        organizationId,
        masterTemplateVersionId,
        effectiveFrom: nowIso,
        effectiveTo: null,
      },
      masterVersion,
      enablementId,
      nowIso,
    );
    await this.enablementRepo.putEnablement(EnablementEntityBuilder.buildRow(meta));
  }

  /**
   * Enable-org catalog: published masters for picker + templateEnabled per org.
   * GET /templates?templateLevel=ORG&organizationId=…
   */
  async listOrgEnableCatalog(params: ListOrgCatalogParams): Promise<ListOrgCatalogResult> {
    try {
      const catalogBasis = await this.masterSvc.listPublishedMasterCatalogItems(params.templateType);

      const masterResult = await this.masterSvc.listMasterTemplates({
        templateType: params.templateType,
        category: params.categoryCode,
        conditionCode: params.conditionCode ?? params.condition,
        country: params.country,
        status:
          params.status === TEMPLATE_STATUS.DRAFT || params.status === TEMPLATE_STATUS.PUBLISHED
            ? (params.status as typeof TEMPLATE_STATUS.DRAFT)
            : TEMPLATE_STATUS.PUBLISHED,
        limit: params.limit,
        nextToken: params.nextToken,
      });

      const enablements = await this.enablementRepo.queryEnablementsByOrgGsi1(
        params.organizationId,
        500,
      );
      const enabledVersionIds = new Set(
        enablements
          .map((e) => e.meta.masterTemplateVersionId)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      );

      let items: OrgEnableCatalogItem[] = masterResult.items.map((row) =>
        mapOrgCatalogItem(row, enabledVersionIds),
      );

      if (params.templateName?.trim()) {
        const needle = params.templateName.trim().toLowerCase();
        items = items.filter((i) => i.templateName?.toLowerCase().includes(needle));
      }

      const counts = {
        total: items.length,
        active: items.filter((i) => i.isActive).length,
        inactive: items.filter((i) => !i.isActive).length,
        templateEnabled: items.filter((i) => i.templateEnabled).length,
      };

      const filterOptions = buildOrgCatalogFilterOptions(
        catalogBasis.map((row) => mapOrgCatalogItem(row, enabledVersionIds)),
      );

      return {
        items,
        pagination: {
          ...masterResult.pagination,
          count: items.length,
          total: items.length,
          hasMore: masterResult.pagination.hasMore && items.length > 0,
        },
        counts,
        filterOptions,
      };
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

  async updateOrgTemplateVersion(params: UpdateOrgTemplateVersionParams) {
    return this.orgOps.updateOrgTemplateVersion(params);
  }

  async transitionOrgTemplateStatus(params: TransitionOrgStatusParams) {
    return this.orgOps.transitionOrgTemplateStatus(params);
  }

  toCreateResponse(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }

  toDeriveEnableResponse(result: DeriveOrgTemplateResult, selectedTemplateName?: string) {
    const org = result.record.meta;
    const master = result.masterVersion.meta;
    const fv = fieldValuesOf({ fieldValues: result.masterVersion.fieldValues });
    return {
      templateId: org.templateId,
      templateVersionId: org.templateVersionId,
      templateName: org.templateName,
      sourceVersionId: master.templateVersionId,
      masterTemplateId: master.templateId,
      masterTemplateName: selectedTemplateName?.trim() || master.templateName,
      templateType: master.templateType,
      version: org.version ?? 1,
      status: org.status ?? TEMPLATE_STATUS.DRAFT,
      isActive: org.isActive ?? false,
      templateEnabled: result.templateEnabled,
      categoryCode: firstString(fv.categoryCode),
      conditionCode: firstString(fv.conditionCode),
      countries: master.countries,
      createdAt: org.createdAt ?? null,
      updatedAt: org.lastModifiedAt ?? null,
    };
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
