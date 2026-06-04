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
import {
  DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
  TEMPLATE_STATUS,
} from '../constants/template.constants';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgTemplateRepository, listOrgNextToken } from '../repositories/org-template.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { TemplateService } from './template.service';
import { OrgTemplateOpsService } from './org-template-ops.service';
import { OrgTemplateSyncService } from './org-template-sync.service';
import { isActiveEnablement, resolveEnablementMasterTemplateId } from '../utils/enablement.utils';
import type {
  TransitionOrgStatusParams,
  UpdateOrgTemplateVersionParams,
} from '../models/api/org-update.types';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import {
  decodeListCursor,
  encodeListCursor,
  firstString,
  normalizeVersionToSk,
  pickHighestVersionRow,
  templateConflictError,
  templateNotFoundError,
  templateVersionIdToSk,
} from '../utils/template.utils';
import type { OrganizationMeta } from '../models/api/list-org-catalog.types';

function fieldValuesOf(record: { fieldValues?: unknown }): Record<string, unknown> {
  const fv = record.fieldValues;
  return fv && typeof fv === 'object' && !Array.isArray(fv) ? (fv as Record<string, unknown>) : {};
}

function mapOrgCatalogItem(
  row: MasterTemplateListItem,
  enabledMasterTemplateIds: Set<string>,
): OrgEnableCatalogItem {
  const fv = fieldValuesOf(row);
  return {
    ...row,
    categoryCode: firstString(fv.categoryCode),
    conditionCode: firstString(fv.conditionCode),
    templateEnabled: enabledMasterTemplateIds.has(row.templateId),
    countries: row.countries,
  };
}

function decodeOffsetToken(token: string | undefined): number {
  const decoded = decodeListCursor(token);
  const offset = decoded?.o;
  return typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function eqCi(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function matchesOrgCatalogFilters(
  item: OrgEnableCatalogItem,
  params: ListOrgCatalogParams,
): boolean {
  if (params.categoryCode && !eqCi(item.categoryCode, params.categoryCode)) return false;
  if (params.conditionCode && !eqCi(item.conditionCode, params.conditionCode)) return false;
  if (params.condition && !eqCi(item.conditionCode, params.condition)) return false;
  if (params.templateType && !eqCi(item.templateType, params.templateType)) return false;
  if (params.country) {
    const countries = item.countries ?? [];
    const hit = countries.some((c) => eqCi(c, params.country));
    if (!hit) return false;
  }
  const nameFilter = params.templateName?.trim();
  if (nameFilter) {
    const byId = eqCi(item.templateId, nameFilter);
    const byName = item.templateName?.toLowerCase().includes(nameFilter.toLowerCase()) ?? false;
    if (!byId && !byName) return false;
  }
  return true;
}

/** filterOptions from all published masters; templateName uses label=name, value=templateId. */
function buildOrgCatalogFilterOptions(items: OrgEnableCatalogItem[]): OrgCatalogFilterOptions {
  const category = new Map<string, string>();
  const templateType = new Map<string, string>();
  const templateName = new Map<string, string>();
  const country = new Map<string, string>();
  const condition = new Map<string, string>();

  for (const item of items) {
    if (item.categoryCode) {
      category.set(item.categoryCode.toUpperCase(), item.categoryCode);
    }
    if (item.templateType) {
      templateType.set(item.templateType.toUpperCase(), item.templateType);
    }
    if (item.templateId) {
      const label = item.templateName?.trim() || item.templateId;
      templateName.set(item.templateId, label);
    }
    if (item.conditionCode) {
      condition.set(item.conditionCode.toUpperCase(), item.conditionCode);
    }
    for (const c of item.countries ?? []) {
      if (typeof c === 'string' && c.trim()) country.set(c.toUpperCase(), c);
    }
  }

  const toOpts = (m: Map<string, string>) =>
    [...m.entries()]
      .map(([value, label]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));

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
  private readonly orgSync = new OrgTemplateSyncService();

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
        if (masterVersion.meta?.status !== TEMPLATE_STATUS.PUBLISHED) {
          templateConflictError(
            'Org enable derive requires a PUBLISHED master template version. Publish the master first.',
          );
        }
      } else {
        masterVersion = await this.resolvePublishedMasterVersion(masterTemplateId);
      }

      const newTemplateName =
        params.body?.newTemplateName?.trim() ||
        masterVersion.meta.templateName?.trim() ||
        masterTemplateId;

      const ctx = OrgTemplateEntityBuilder.buildCloneContext(
        params.organizationId,
        masterTemplateId,
        masterVersion.meta.templateVersionId,
        newTemplateName,
        true,
      );

      const existing = await this.orgRepo.getOrgMeta(params.organizationId, ctx.newTemplateId);
      if (existing) {
        const versionRow = await this.orgSync.syncOrgTemplateContentFromMaster(
          params.organizationId,
          ctx.newTemplateId,
          masterTemplateId,
          masterVersion,
          params.actorUser,
        );
        await this.orgSync.upsertEnablementForOrg(
          params.organizationId,
          masterVersion,
          ctx.newTemplateId,
        );
        return { record: versionRow, masterVersion, templateEnabled: true };
      }

      const meta = OrgTemplateEntityBuilder.buildOrgMetaFromMaster(
        masterVersion,
        ctx,
        params.actorUser,
      );
      const metaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(
        meta,
        params.organizationId,
        ctx.newTemplateId,
      );
      const versionRow = OrgTemplateEntityBuilder.buildOrgVersionRow(meta, ctx, masterVersion);

      await this.orgRepo.createOrgTemplate(metaRow, versionRow);

      await this.orgSync.upsertEnablementForOrg(
        params.organizationId,
        masterVersion,
        ctx.newTemplateId,
      );

      return { record: versionRow, masterVersion, templateEnabled: true };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  /**
   * Enable-org catalog: published masters for picker + templateEnabled per org.
   * GET /templates?templateLevel=ORG&organizationId=…
   */
  async listOrgEnableCatalog(params: ListOrgCatalogParams): Promise<ListOrgCatalogResult> {
    try {
      const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
      const publishedMasters = await this.masterSvc.listPublishedMasterCatalogItems();

      const enablements = await this.enablementRepo.queryEnablementsByOrgGsi1(
        params.organizationId,
        500,
      );
      const enabledMasterTemplateIds = new Set(
        enablements
          .filter(isActiveEnablement)
          .map((e) => resolveEnablementMasterTemplateId(e.meta))
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      );

      const allCatalogItems = publishedMasters.map((row) =>
        mapOrgCatalogItem(row, enabledMasterTemplateIds),
      );

      const filtered = allCatalogItems.filter((item) => matchesOrgCatalogFilters(item, params));
      const total = filtered.length;
      const offset = decodeOffsetToken(params.nextToken);
      const page = filtered.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const hasMore = nextOffset < total;

      const counts = {
        total: filtered.length,
        active: filtered.filter((i) => i.isActive).length,
        inactive: filtered.filter((i) => !i.isActive).length,
        templateEnabled: filtered.filter((i) => i.templateEnabled).length,
      };

      const filterOptions = buildOrgCatalogFilterOptions(allCatalogItems);

      const organizationMeta: OrganizationMeta = {
        id: params.organizationId,
        name: params.organizationName?.trim() || params.organizationId,
        description: params.organizationDescription?.trim() || null,
      };

      return {
        organizationMeta,
        items: page,
        pagination: {
          limit,
          count: page.length,
          total,
          hasMore,
          nextToken: hasMore ? encodeListCursor({ o: nextOffset }) : undefined,
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
        organizationMeta: {
          id: params.organizationId,
          name: params.organizationName?.trim() || params.organizationId,
          description: params.organizationDescription?.trim() || null,
        },
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
          limit: DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
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

  toDeriveEnableResponse(
    result: DeriveOrgTemplateResult,
    opts?: { organizationMeta?: OrganizationMeta },
  ) {
    const org = result.record.meta;
    const master = result.masterVersion.meta;
    const fv = fieldValuesOf({ fieldValues: result.masterVersion.fieldValues });
    const organizationMeta: OrganizationMeta = opts?.organizationMeta ?? {
      id: org.ownerOrgId ?? '',
      name: org.ownerOrgId ?? '',
      description: null,
    };
    return {
      organizationMeta,
      templateId: org.templateId,
      templateVersionId: org.templateVersionId,
      templateName: org.templateName,
      sourceVersionId: master.templateVersionId,
      masterTemplateId: master.templateId,
      masterTemplateName: master.templateName,
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
