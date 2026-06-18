import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import type {
  ListOrgEnabledParams,
  ListOrgEnabledResult,
  OrgEnabledFilterOptions,
  OrgEnabledListItem,
  OrgEnabledOrganizationGroup,
  OrganizationMeta,
} from '../models/api/list-org-catalog.types';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import {
  type MasterTemplateListItem,
  toOrgListItem,
  toOrgVersionSummary,
  toTemplateSummary,
} from '../mappers/template-http.dto';
import type {
  GetOrgVersionStatusParams,
  OrgVersionStatusResult,
} from '../models/api/org-version-status.types';
import type {
  CloneOrgTemplateParams,
  DeriveOrgTemplateResult,
  GetOrgVersionsParams,
  GetOrgVersionsResult,
  ListOrgTemplatesParams,
  ListOrgTemplatesResult,
  OrganizationMetaInput,
  SetOrgTemplateEnableParams,
  SetOrgTemplateEnableResult,
} from '../models/api/org-template.types';
import type { VersionResolveStrategy } from '../models/api/get-master-versions.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import {
  DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
  TEMPLATE_STATUS,
  VERSION_SK_PREFIX,
} from '../constants/template.constants';
import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgProfileRepository } from '../repositories/org-profile.repository';
import { OrgTemplateRepository, listOrgNextToken } from '../repositories/org-template.repository';
import { TemplateRepository } from '../repositories/template.repository';
import { TemplateService } from './template.service';
import { OrgTemplateOpsService } from './org-template-ops.service';
import { OrgTemplateRulesService } from './org-template-rules.service';
import type {
  GetOrgTemplateRulesParams,
  UpdateOrgTemplateRulesParams,
} from '../models/api/org-template-rules.types';
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
  compareTemplateDisplayVersions,
  formatTemplateVersionLabel,
  resolveMasterTemplateIsActive,
  resolveTemplateDisplayVersion,
  templateVersionIdToSk,
} from '../utils/template.utils';

const VERSION_COMPARE_DOC_KEYS = ['fieldValues', 'links', 'steps', 'carePlanAttributes', 'overrides'] as const;

/** Static country options for org-enabled list filter dropdowns. */
export const ORG_ENABLED_COUNTRY_OPTIONS = ['US', 'UK', 'Australia'] as const;

function extractComparableTemplatePayload(record: TemplateDdbRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    templateName: record.meta.templateName ?? null,
  };
  for (const key of VERSION_COMPARE_DOC_KEYS) {
    if (key in record) {
      out[key] = record[key as keyof TemplateDdbRecord];
    }
  }
  return out;
}

function stableComparableJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

function detectLocalChanges(
  orgVersion: TemplateDdbRecord,
  derivedMasterVersion: TemplateDdbRecord,
): boolean {
  const orgPayload = extractComparableTemplatePayload(orgVersion);
  const masterPayload = extractComparableTemplatePayload(derivedMasterVersion);
  return stableComparableJson(orgPayload) !== stableComparableJson(masterPayload);
}

function resolveDerivedFromMasterVersion(
  orgMeta: TemplateMeta,
  enablementMeta: EnablementDdbRecord['meta'],
  derivedMasterMeta: TemplateMeta,
): number {
  if (
    typeof orgMeta.derivedFromMasterVersion === 'number' &&
    orgMeta.derivedFromMasterVersion > 0
  ) {
    return orgMeta.derivedFromMasterVersion;
  }
  if (
    typeof enablementMeta.masterTemplateVersion === 'number' &&
    enablementMeta.masterTemplateVersion > 0
  ) {
    return enablementMeta.masterTemplateVersion;
  }
  return resolveTemplateDisplayVersion(derivedMasterMeta);
}

function fieldValuesOf(record: { fieldValues?: unknown }): Record<string, unknown> {
  const fv = record.fieldValues;
  return fv && typeof fv === 'object' && !Array.isArray(fv) ? (fv as Record<string, unknown>) : {};
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

function isAllCountryFilter(country: string | undefined): boolean {
  return country?.trim().toLowerCase() === 'all';
}

function listItemFieldValues(item: MasterTemplateListItem): Record<string, unknown> {
  const fv = item.fieldValues;
  return fv && typeof fv === 'object' && !Array.isArray(fv) ? fv : {};
}

function masterCodesFromItem(item: MasterTemplateListItem): {
  categoryCode?: string;
  conditionCode?: string;
} {
  const fv = listItemFieldValues(item);
  return {
    categoryCode: firstString(fv.categoryCode) ?? firstString(fv.category),
    conditionCode: firstString(fv.conditionCode) ?? firstString(fv.condition),
  };
}

function matchesMasterCatalogFilter(
  item: MasterTemplateListItem,
  filters: {
    templateType?: string;
    categoryCode?: string;
    conditionCode?: string;
    condition?: string;
  },
): boolean {
  const codes = masterCodesFromItem(item);
  if (filters.categoryCode && !eqCi(codes.categoryCode, filters.categoryCode)) {
    return false;
  }
  const conditionFilter = filters.conditionCode ?? filters.condition;
  if (conditionFilter && !eqCi(codes.conditionCode, conditionFilter)) {
    return false;
  }
  if (filters.templateType && !eqCi(item.templateType, filters.templateType)) {
    return false;
  }
  return true;
}

function buildOrgEnabledFilterOptions(
  items: MasterTemplateListItem[],
  filters: {
    templateType?: string;
    categoryCode?: string;
    conditionCode?: string;
    condition?: string;
  } = {},
): OrgEnabledFilterOptions {
  const conditionCode = new Set<string>();
  const categoryCode = new Set<string>();
  const templateType = new Set<string>();
  const templateNameKeys = new Set<string>();
  const templateName: { key: string; value: string }[] = [];

  for (const item of items) {
    if (item.status !== TEMPLATE_STATUS.PUBLISHED) continue;
    const codes = masterCodesFromItem(item);
    if (codes.conditionCode) conditionCode.add(codes.conditionCode);
    if (codes.categoryCode) categoryCode.add(codes.categoryCode);

    if (!matchesMasterCatalogFilter(item, filters)) continue;

    if (item.templateType) templateType.add(item.templateType);
    if (item.templateId && !templateNameKeys.has(item.templateId)) {
      templateNameKeys.add(item.templateId);
      templateName.push({
        key: item.templateId,
        value: item.templateName?.trim() || item.templateId,
      });
    }
  }

  const sortStr = (a: string, b: string) => a.localeCompare(b);
  return {
    conditionCode: [...conditionCode].sort(sortStr),
    categoryCode: [...categoryCode].sort(sortStr),
    templateType: [...templateType].sort(sortStr),
    templateName: templateName.sort((a, b) => a.value.localeCompare(b.value)),
    country: [...ORG_ENABLED_COUNTRY_OPTIONS],
  };
}

function matchesOrganizationMetaFilters(
  orgMeta: OrganizationMeta,
  params: ListOrgEnabledParams,
): boolean {
  const nameFilter = params.organizationName?.trim();
  if (nameFilter) {
    const name = orgMeta.name?.trim() ?? '';
    const byId = eqCi(orgMeta.id, nameFilter);
    const byName = name.toLowerCase().includes(nameFilter.toLowerCase());
    if (!byId && !byName) return false;
  }
  if (params.country && !isAllCountryFilter(params.country) && !eqCi(orgMeta.country, params.country)) {
    return false;
  }
  const descFilter = params.organizationDescription?.trim();
  if (descFilter) {
    const desc = orgMeta.description?.trim() ?? '';
    if (!desc.toLowerCase().includes(descFilter.toLowerCase())) return false;
  }
  return true;
}

function matchesOrgEnabledFilters(
  item: OrgEnabledListItem,
  params: ListOrgEnabledParams,
): boolean {
  const m = item.masterTemplate;
  if (params.categoryCode && !eqCi(m.categoryCode, params.categoryCode)) return false;
  if (params.conditionCode && !eqCi(m.conditionCode, params.conditionCode)) return false;
  if (params.condition && !eqCi(m.conditionCode, params.condition)) return false;
  if (params.templateType && !eqCi(m.templateType, params.templateType)) return false;
  const idFilter = params.templateId?.trim();
  if (idFilter && !eqCi(m.templateId, idFilter)) return false;
  const nameFilter = params.templateName?.trim();
  if (nameFilter) {
    const byId = eqCi(m.templateId, nameFilter);
    const byName = m.templateName?.toLowerCase().includes(nameFilter.toLowerCase()) ?? false;
    if (!byId && !byName) return false;
  }
  const enabledFilter = params.templateEnabled ?? true;
  if (enabledFilter && !item.templateEnabled) return false;
  if (!enabledFilter && item.templateEnabled) return false;
  return true;
}

export class OrgTemplateService {
  private readonly orgOps = new OrgTemplateOpsService();
  private readonly orgRules = new OrgTemplateRulesService();
  private readonly masterSvc = new TemplateService();
  private readonly orgSync = new OrgTemplateSyncService();

  constructor(
    private readonly orgRepo = new OrgTemplateRepository(),
    private readonly masterRepo = new TemplateRepository(),
    private readonly enablementRepo = new EnablementRepository(),
    private readonly orgProfileRepo = new OrgProfileRepository(),
  ) {}

  private async resolveStoredOrganizationMeta(
    organizationId: string,
    query?: Pick<ListOrgEnabledParams, 'organizationName' | 'organizationDescription'>,
  ): Promise<OrganizationMeta> {
    const profile = await this.orgProfileRepo.getOrgProfile(organizationId);
    const stored = profile?.meta;
    return {
      id: organizationId,
      name: stored?.name?.trim() || query?.organizationName?.trim() || organizationId,
      active: stored?.active,
      country: stored?.country,
      updated: stored?.updated,
      description: stored?.description ?? query?.organizationDescription?.trim() ?? null,
    };
  }

  private async upsertOrganizationProfile(input: OrganizationMetaInput): Promise<OrganizationMeta> {
    const meta: OrganizationMetaInput = {
      id: input.id.trim(),
      name: input.name.trim(),
      active: input.active,
      country: input.country?.trim(),
      updated:
        input.updated === undefined || input.updated === null
          ? new Date().toISOString()
          : String(input.updated).trim() || new Date().toISOString(),
      description: input.description ?? null,
    };
    await this.orgProfileRepo.putOrgProfile(meta);
    return {
      id: meta.id,
      name: meta.name,
      active: meta.active,
      country: meta.country,
      updated: meta.updated,
      description: meta.description ?? null,
    };
  }

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
        const enablement = await this.orgSync.upsertEnablementForOrg(
          params.organizationId,
          masterVersion,
          ctx.newTemplateId,
        );
        if (params.body?.organizationMeta) {
          await this.upsertOrganizationProfile(params.body.organizationMeta);
        }
        return { record: versionRow, masterVersion, enablement, templateEnabled: true };
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

      const enablement = await this.orgSync.upsertEnablementForOrg(
        params.organizationId,
        masterVersion,
        ctx.newTemplateId,
      );

      if (params.body?.organizationMeta) {
        await this.upsertOrganizationProfile(params.body.organizationMeta);
      }

      return { record: versionRow, masterVersion, enablement, templateEnabled: true };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  /**
   * GET /templates?templateLevel=ORG — enabled org copies + master filterOptions.
   * Without organizationId (ROOT): organizations[] for orgs with ≥1 enablement.
   * With organizationId: organizationMeta + items[] for that org.
   */
  async listOrgEnabled(params: ListOrgEnabledParams): Promise<ListOrgEnabledResult> {
    try {
      const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
      const publishedMasters = await this.masterSvc.listPublishedMasterCatalogItems();
      const masterById = new Map(publishedMasters.map((m) => [m.templateId, m]));
      const filterOptions = buildOrgEnabledFilterOptions(publishedMasters, {
        templateType: params.templateType,
        categoryCode: params.categoryCode,
        conditionCode: params.conditionCode,
        condition: params.condition,
      });

      if (params.organizationId) {
        return this.listOrgEnabledForSingleOrg(
          { ...params, organizationId: params.organizationId },
          {
            limit,
            masterById,
            filterOptions,
          },
        );
      }

      return this.listOrgEnabledForAllOrgs(params, {
        limit,
        publishedMasters,
        masterById,
        filterOptions,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private async listOrgEnabledForSingleOrg(
    params: ListOrgEnabledParams & { organizationId: string },
    ctx: {
      limit: number;
      masterById: Map<string, MasterTemplateListItem>;
      filterOptions: OrgEnabledFilterOptions;
    },
  ): Promise<ListOrgEnabledResult> {
    const organizationId = params.organizationId;
    const enablements = await this.enablementRepo.queryEnablementsByOrgGsi1(organizationId, 500);

    const items: OrgEnabledListItem[] = [];
    for (const en of enablements) {
      const row = await this.buildOrgEnabledListItem(en, ctx.masterById, organizationId);
      if (row) items.push(row);
    }

    const organizationMeta = await this.resolveStoredOrganizationMeta(organizationId, params);
    if (!matchesOrganizationMetaFilters(organizationMeta, params)) {
      return {
        mode: 'single',
        organizationMeta,
        items: [],
        counts: { total: 0 },
        filterOptions: ctx.filterOptions,
        pagination: {
          limit: ctx.limit,
          count: 0,
          total: 0,
          hasMore: false,
        },
      };
    }

    const filtered = items.filter((item) => matchesOrgEnabledFilters(item, params));
    const total = filtered.length;
    const offset = decodeOffsetToken(params.nextToken);
    const page = filtered.slice(offset, offset + ctx.limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < total;

    return {
      mode: 'single',
      organizationMeta,
      items: page,
      counts: { total },
      filterOptions: ctx.filterOptions,
      pagination: {
        limit: ctx.limit,
        count: page.length,
        total,
        hasMore,
        nextToken: hasMore ? encodeListCursor({ o: nextOffset }) : undefined,
      },
    };
  }

  private async listOrgEnabledForAllOrgs(
    params: ListOrgEnabledParams,
    ctx: {
      limit: number;
      publishedMasters: MasterTemplateListItem[];
      masterById: Map<string, MasterTemplateListItem>;
      filterOptions: OrgEnabledFilterOptions;
    },
  ): Promise<ListOrgEnabledResult> {
    const enablements = await this.collectAllEnablementsAcrossMasters(ctx.publishedMasters);
    const byOrg = new Map<string, EnablementDdbRecord[]>();

    for (const en of enablements) {
      const orgId = en.meta.organizationId?.trim();
      if (!orgId) continue;
      const list = byOrg.get(orgId) ?? [];
      list.push(en);
      byOrg.set(orgId, list);
    }

    const groups: OrgEnabledOrganizationGroup[] = [];
    let totalEnabledTemplates = 0;
    let totalActiveOrganizations = 0;
    let totalInactiveOrganizations = 0;

    for (const [orgId, orgEnablements] of byOrg.entries()) {
      const items: OrgEnabledListItem[] = [];
      for (const en of orgEnablements) {
        const row = await this.buildOrgEnabledListItem(en, ctx.masterById, orgId);
        if (row) items.push(row);
      }
      const organizationMeta = await this.resolveStoredOrganizationMeta(orgId, params);
      if (!matchesOrganizationMetaFilters(organizationMeta, params)) continue;

      const filtered = items.filter((item) => matchesOrgEnabledFilters(item, params));
      if (filtered.length === 0) continue;

      groups.push({
        organizationMeta,
        items: filtered,
        counts: { total: filtered.length },
      });
      if (organizationMeta.active === true) {
        totalActiveOrganizations += 1;
      } else {
        totalInactiveOrganizations += 1;
      }
      totalEnabledTemplates += filtered.filter((item) => item.templateEnabled).length;
    }

    groups.sort((a, b) => a.organizationMeta.id.localeCompare(b.organizationMeta.id));

    const total = groups.length;
    const offset = decodeOffsetToken(params.nextToken);
    const page = groups.slice(offset, offset + ctx.limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < total;

    return {
      mode: 'all',
      organizations: page,
      counts: {
        totalOrganizations: total,
        totalActiveOrganizations,
        totalInactiveOrganizations,
        totalEnabledTemplates,
      },
      filterOptions: ctx.filterOptions,
      pagination: {
        limit: ctx.limit,
        count: page.length,
        total,
        hasMore,
        nextToken: hasMore ? encodeListCursor({ o: nextOffset }) : undefined,
      },
    };
  }

  private async collectAllEnablementsAcrossMasters(
    publishedMasters: MasterTemplateListItem[],
  ): Promise<EnablementDdbRecord[]> {
    const seen = new Set<string>();
    const out: EnablementDdbRecord[] = [];

    for (const master of publishedMasters) {
      const rows = await this.enablementRepo.queryEnablementsByMasterTemplateGsi5(
        master.templateId,
        200,
      );
      for (const row of rows) {
        const id = row.meta.enablementId;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(row);
      }
    }

    return out;
  }

  /**
   * Compare latest published master display version vs org-derived master version.
   * Same rules as GET /templates/org-version-status (`upgradeAvailable`).
   */
  private async resolveUpgradeAvailable(params: {
    masterTemplateId: string;
    enablement: EnablementDdbRecord;
    orgVersion: TemplateDdbRecord | null;
    catalogMaster?: MasterTemplateListItem;
  }): Promise<boolean> {
    const { masterTemplateId, enablement, orgVersion, catalogMaster } = params;
    if (!orgVersion) return false;

    let latestMasterVersion: number;
    if (catalogMaster) {
      latestMasterVersion = resolveTemplateDisplayVersion({
        version: catalogMaster.version,
        templateVersionId: catalogMaster.templateVersionId,
      });
    } else {
      try {
        const latestRow = await this.resolvePublishedMasterVersion(masterTemplateId);
        latestMasterVersion = resolveTemplateDisplayVersion(latestRow.meta);
      } catch {
        return false;
      }
    }

    const derivedFromMasterVersionId =
      orgVersion.meta.derivedFromTemplateVersionId?.trim() ||
      enablement.meta.masterTemplateVersionId?.trim();

    let derivedMasterMeta: TemplateMeta = orgVersion.meta;
    if (derivedFromMasterVersionId) {
      const derivedSk = normalizeVersionToSk(derivedFromMasterVersionId);
      const derivedRow = await this.masterRepo.getMasterVersion(masterTemplateId, derivedSk);
      if (derivedRow?.meta) derivedMasterMeta = derivedRow.meta;
    }

    const derivedFromMasterVersion = resolveDerivedFromMasterVersion(
      orgVersion.meta,
      enablement.meta,
      derivedMasterMeta,
    );

    return compareTemplateDisplayVersions(latestMasterVersion, derivedFromMasterVersion) > 0;
  }

  private async buildOrgEnabledListItem(
    enablement: EnablementDdbRecord,
    masterById: Map<string, MasterTemplateListItem>,
    organizationId: string,
  ): Promise<OrgEnabledListItem | null> {
    const masterTemplateId = resolveEnablementMasterTemplateId(enablement.meta);
    if (!masterTemplateId) return null;

    const catalogMaster = masterById.get(masterTemplateId);
    const masterVersionId =
      enablement.meta.masterTemplateVersionId?.trim() ||
      catalogMaster?.templateVersionId;
    if (!masterVersionId) return null;

    const masterMeta = catalogMaster;
    const codes = masterMeta ? masterCodesFromItem(masterMeta) : {};
    const orgTemplateId = enablement.meta.orgTemplateId?.trim();
    if (!orgTemplateId) return null;

    const orgVersion = await this.resolveOrgActiveVersionRow(organizationId, orgTemplateId);
    const orgTemplateVersionId =
      orgVersion?.meta.templateVersionId?.trim() ||
      `${orgTemplateId}-V01`;

    const templateEnabled = isActiveEnablement(enablement);
    const enabledAt =
      enablement.meta.effectiveFrom?.trim() ||
      enablement.meta.createdAt?.trim() ||
      new Date().toISOString();
    const disabledAt = templateEnabled
      ? null
      : enablement.meta.effectiveTo?.trim() || enablement.meta.updatedAt?.trim() || null;

    const upgrade = await this.resolveUpgradeAvailable({
      masterTemplateId,
      enablement,
      orgVersion,
      catalogMaster: masterMeta,
    });

    return {
      masterTemplate: {
        templateId: masterTemplateId,
        templateVersionId: masterVersionId,
        templateName: enablement.meta.templateName ?? masterMeta?.templateName,
        templateType: enablement.meta.templateType ?? masterMeta?.templateType,
        categoryCode: enablement.meta.categoryCode ?? codes.categoryCode,
        conditionCode: enablement.meta.conditionCode ?? codes.conditionCode,
        status: masterMeta?.status ?? TEMPLATE_STATUS.PUBLISHED,
        isActive: masterMeta?.isActive ?? true,
      },
      orgTemplate: {
        templateId: orgTemplateId,
        templateVersionId: orgTemplateVersionId,
        status: orgVersion?.meta.status ?? TEMPLATE_STATUS.DRAFT,
      },
      enablementId: enablement.meta.enablementId,
      enabledAt,
      templateEnabled,
      disabledAt,
      upgrade,
    };
  }

  /**
   * Enable or disable org subscription to a master (PUT /templates/derive).
   * Disable sets enablement `effectiveTo`; re-enable clears it. Org copy is retained.
   */
  async setOrgTemplateEnablement(
    params: SetOrgTemplateEnableParams,
  ): Promise<SetOrgTemplateEnableResult> {
    try {
      const masterTemplateId = TemplateEntityBuilder.normalizeTemplateId(params.masterTemplateId);
      const organizationId = params.organizationId.trim();
      const enablement = await this.enablementRepo.findByOrgAndMasterTemplateId(
        organizationId,
        masterTemplateId,
      );
      if (!enablement) {
        templateNotFoundError('This master template is not enabled for the organization.');
      }

      const nowIso = new Date().toISOString();
      const wantEnabled = params.templateEnabled;

      if (params.organizationMeta) {
        await this.upsertOrganizationProfile(params.organizationMeta);
      }

      const organizationMeta = await this.resolveStoredOrganizationMeta(organizationId, {
        organizationName: params.organizationMeta?.name ?? params.organizationName,
        organizationDescription:
          params.organizationMeta?.description ?? params.organizationDescription,
      });

      if (wantEnabled && isActiveEnablement(enablement)) {
        return {
          organizationMeta,
          templateId: masterTemplateId,
          orgTemplateId: enablement.meta.orgTemplateId,
          enablementId: enablement.meta.enablementId,
          templateEnabled: true,
          disabledAt: null,
        };
      }

      if (!wantEnabled && !isActiveEnablement(enablement)) {
        return {
          organizationMeta,
          templateId: masterTemplateId,
          orgTemplateId: enablement.meta.orgTemplateId,
          enablementId: enablement.meta.enablementId,
          templateEnabled: false,
          disabledAt: enablement.meta.effectiveTo?.trim() || nowIso,
        };
      }

      const updated = EnablementEntityBuilder.applyDateUpdates(enablement, {
        effectiveTo: wantEnabled ? null : nowIso,
        ...(wantEnabled ? { effectiveFrom: nowIso } : {}),
      });
      updated.meta.updatedAt = nowIso;
      await this.enablementRepo.putEnablementOverwrite(updated);

      return {
        organizationMeta,
        templateId: masterTemplateId,
        orgTemplateId: updated.meta.orgTemplateId,
        enablementId: updated.meta.enablementId,
        templateEnabled: wantEnabled,
        disabledAt: wantEnabled ? null : nowIso,
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  private async resolveOrgActiveVersionRow(
    organizationId: string,
    orgTemplateId: string,
  ): Promise<TemplateDdbRecord | null> {
    const metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
    if (!metaRow) return null;

    return this.orgRepo.getOrgVersionForMeta(organizationId, orgTemplateId, metaRow.meta);
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

  /**
   * GET /templates/org-version-status — one org + master template version row for UI table.
   */
  async getOrgVersionStatus(params: GetOrgVersionStatusParams): Promise<OrgVersionStatusResult> {
    try {
      const masterTemplateId = TemplateEntityBuilder.normalizeTemplateId(params.masterTemplateId);
      const organizationId = params.organizationId.trim();

      const enablement = await this.enablementRepo.findByOrgAndMasterTemplateId(
        organizationId,
        masterTemplateId,
      );
      if (!enablement || !isActiveEnablement(enablement)) {
        templateNotFoundError('This master template is not enabled for the organization.');
      }

      const orgTemplateId = enablement.meta.orgTemplateId?.trim();
      if (!orgTemplateId) {
        templateNotFoundError('Org template not found for this enablement.');
      }

      const orgVersion = await this.resolveOrgActiveVersionRow(organizationId, orgTemplateId);
      if (!orgVersion) {
        templateNotFoundError('Org template not found');
      }

      const derivedFromMasterVersionId =
        orgVersion.meta.derivedFromTemplateVersionId?.trim() ||
        enablement.meta.masterTemplateVersionId?.trim();
      if (!derivedFromMasterVersionId) {
        templateNotFoundError('Derived master version not found for org template.');
      }

      const derivedSk = normalizeVersionToSk(derivedFromMasterVersionId);
      const derivedMasterVersion = await this.masterRepo.getMasterVersion(masterTemplateId, derivedSk);
      if (!derivedMasterVersion) {
        templateNotFoundError('Master template version not found');
      }

      const latestMasterVersionRow = await this.resolvePublishedMasterVersion(masterTemplateId);

      const currentOrgVersion = resolveTemplateDisplayVersion(orgVersion.meta);

      const derivedFromMasterVersion = resolveDerivedFromMasterVersion(
        orgVersion.meta,
        enablement.meta,
        derivedMasterVersion.meta,
      );
      const latestMasterVersion = resolveTemplateDisplayVersion(latestMasterVersionRow.meta);

      const upgradeAvailable = await this.resolveUpgradeAvailable({
        masterTemplateId,
        enablement,
        orgVersion,
        catalogMaster: {
          templateId: masterTemplateId,
          templateVersionId: latestMasterVersionRow.meta.templateVersionId,
          version: latestMasterVersion,
          status: TEMPLATE_STATUS.PUBLISHED,
          isActive: resolveMasterTemplateIsActive(latestMasterVersionRow.meta),
        },
      });
      const localChangesPresent = detectLocalChanges(orgVersion, derivedMasterVersion);

      const templateName =
        orgVersion.meta.templateName?.trim() ||
        enablement.meta.templateName?.trim() ||
        masterTemplateId;

      const organizationMeta = await this.resolveStoredOrganizationMeta(organizationId, params);

      return {
        organizationMeta,
        templateId: masterTemplateId,
        templateName,
        orgTemplateId,
        currentOrgVersion,
        currentOrgVersionLabel: formatTemplateVersionLabel(currentOrgVersion),
        currentOrgTemplateVersionId: orgVersion.meta.templateVersionId,
        derivedFromMasterVersion,
        derivedFromMasterVersionLabel: formatTemplateVersionLabel(derivedFromMasterVersion),
        derivedFromMasterVersionId,
        latestMasterVersion,
        latestMasterVersionLabel: formatTemplateVersionLabel(latestMasterVersion),
        latestMasterTemplateVersionId: latestMasterVersionRow.meta.templateVersionId,
        upgradeAvailable,
        upgradeStatus: upgradeAvailable ? 'AVAILABLE' : 'NONE',
        localChangesPresent,
        localChangesLabel: localChangesPresent ? 'Present' : 'None',
        enablementId: enablement.meta.enablementId,
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async updateOrgTemplateVersion(params: UpdateOrgTemplateVersionParams) {
    return this.orgOps.updateOrgTemplateVersion(params);
  }

  async getOrgTemplateRules(params: GetOrgTemplateRulesParams) {
    return this.orgRules.getOrgTemplateRules(params);
  }

  async updateOrgTemplateRules(params: UpdateOrgTemplateRulesParams) {
    return this.orgRules.updateOrgTemplateRules(params);
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
    const codes = {
      categoryCode: firstString(fv.categoryCode) ?? firstString(master.category),
      conditionCode: firstString(fv.conditionCode) ?? firstString(master.condition),
    };
    const ownerOrgId = typeof org.ownerOrgId === 'string' ? org.ownerOrgId : '';
    const organizationMeta: OrganizationMeta = opts?.organizationMeta ?? {
      id: ownerOrgId,
      name: ownerOrgId,
      description: null,
    };
    return {
      organizationMeta,
      masterTemplate: {
        templateId: master.templateId,
        templateVersionId: master.templateVersionId,
        templateName: master.templateName,
        templateType: master.templateType,
        categoryCode: codes.categoryCode,
        conditionCode: codes.conditionCode,
        status: master.status ?? TEMPLATE_STATUS.PUBLISHED,
        isActive: resolveMasterTemplateIsActive(master),
      },
      orgTemplate: {
        templateId: org.templateId,
        templateVersionId: org.templateVersionId,
        status: org.status ?? TEMPLATE_STATUS.DRAFT,
        derivedFromMasterVersionId: master.templateVersionId,
      },
      templateEnabled: true,
      enablementId: result.enablement.meta.enablementId,
    };
  }

  toSummary(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
