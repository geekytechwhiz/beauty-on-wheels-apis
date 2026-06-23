import { EnablementEntityBuilder } from '../builder/enablement-entity.builder';
import { OrgTemplateEntityBuilder } from '../builder/org-template-entity.builder';
import {
  DEFAULT_TEMPLATE_LIST_PAGE_SIZE,
  DERIVATION_KIND,
  ORG_EDITABLE_STATUSES,
  TEMPLATE_META_SK,
  TEMPLATE_STATUS,
  type TemplateStatus,
} from '../constants/template.constants';
import {
  buildOrgDerivedFilterOptions,
  resolveOrgDerivedItemHistory,
  toAdoptOrgDerivedResult,
  toOrgDerivedCreateResult,
  toOrgDerivedDetail,
  toOrgDerivedListItem,
  toUpdateOrgDerivedResult,
} from '../mappers/org-derived.dto';
import { appendVersionHistoryToRecord } from '../mappers/template-http.dto';
import type {
  OrgDerivedCreateParams,
  OrgDerivedCreateResult,
  AdoptOrgDerivedParams,
  AdoptOrgDerivedResult,
  GetOrgDerivedResult,
  ListOrgDerivedParams,
  ListOrgDerivedResult,
  UpdateOrgDerivedParams,
  UpdateOrgDerivedResult,
} from '../models/api/org-derived.types';
import type { OrganizationMeta } from '../models/api/list-org-catalog.types';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { OrgProfileMeta } from '../models/persistence/org-profile.model';
import { EnablementRepository } from '../repositories/enablement.repository';
import { OrgProfileRepository } from '../repositories/org-profile.repository';
import { OrgTemplateRepository } from '../repositories/org-template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { isActiveEnablement } from '../utils/enablement.utils';
import { extractCatalogCodes } from '../utils/field-values-profile.utils';
import {
  asTemplateRulesMap,
  buildRulesFromFieldValues,
  mergeOrgRulesPartial,
  mergeRulesAfterFieldValuesChange,
  OrgRulesValidationError,
} from '../utils/template-rules.utils';
import {
  applyAdoptHistoryOverride,
  buildOrgDerivedAdoptPreview,
  mergeVariantAdoptDocument,
  resolveCanonicalSnapshotRow,
} from '../utils/org-derived-adopt.utils';
import {
  decodeListCursor,
  encodeListCursor,
  normalizeVersionToSk,
  resolveTemplateDisplayVersion,
  templateConflictError,
  templateNotFoundError,
  templateValidationError,
} from '../utils/template.utils';
import { OrgTemplateOpsService } from './org-template-ops.service';

function eqCi(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function decodeOffsetToken(token: string | undefined): number {
  const decoded = decodeListCursor(token);
  const offset = decoded?.o;
  return typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasFieldValuesPatch(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function assertEditableStatus(status: TemplateStatus | undefined, action: string): void {
  if (!status || !ORG_EDITABLE_STATUSES.includes(status)) {
    templateConflictError(
      `Cannot ${action} org template in status ${status ?? 'UNKNOWN'}; only DRAFT, SAVED, or IN_REVIEW are editable`,
    );
  }
}

function buildOrgDerivedMetaOverrides(params: {
  status?: TemplateStatus;
  active?: boolean;
  currentMeta: TemplateDdbRecord['meta'];
  nowIso: string;
}): Partial<TemplateDdbRecord['meta']> {
  const overrides: Partial<TemplateDdbRecord['meta']> = {};

  if (params.status !== undefined) {
    overrides.status = params.status;
    if (params.status === TEMPLATE_STATUS.PUBLISHED) {
      overrides.publishedAt = params.currentMeta.publishedAt ?? params.nowIso;
    }
    if (params.status === TEMPLATE_STATUS.DRAFT) {
      overrides.publishedAt = null;
    }
  }

  if (params.active !== undefined) {
    overrides.isActive = params.active;
  }

  return overrides;
}

function resolveMetaStatus(meta: TemplateDdbRecord['meta']): TemplateStatus {
  return (meta.status ?? TEMPLATE_STATUS.DRAFT) as TemplateStatus;
}

function isOrgDerivedVariant(meta: TemplateDdbRecord['meta']): boolean {
  return meta.derivationKind === DERIVATION_KIND.ORG_DERIVE;
}

type OrgDerivedRow = {
  metaRow: TemplateDdbRecord;
  versionRow: TemplateDdbRecord;
  enablement: EnablementDdbRecord | null;
};

export class OrgDerivedService {
  constructor(
    private readonly orgRepo = new OrgTemplateRepository(),
    private readonly enablementRepo = new EnablementRepository(),
    private readonly orgProfileRepo = new OrgProfileRepository(),
    private readonly orgOps = new OrgTemplateOpsService(),
  ) {}

  async createOrgDerived(params: OrgDerivedCreateParams): Promise<OrgDerivedCreateResult> {
    try {
      const organizationId = params.organizationId.trim();
      const sourceOrgTemplateId = params.sourceOrgTemplateId.trim();
      const newTemplateName = params.newTemplateName.trim();
      const templateEnabled = params.templateEnabled !== false;
      const nowIso = new Date().toISOString();

      if (params.organizationMeta) {
        await this.upsertOrganizationProfile(params.organizationMeta);
      }

      const sourceMetaRow = await this.orgRepo.getOrgMeta(organizationId, sourceOrgTemplateId);
      if (!sourceMetaRow) {
        templateNotFoundError('Source org template not found');
      }

      if (isOrgDerivedVariant(sourceMetaRow.meta)) {
        templateConflictError(
          'sourceOrgTemplateId must be the canonical org template from derive, not an org-derived variant',
        );
      }

      let sourceVersionRow: TemplateDdbRecord | null = null;
      if (params.sourceVersionId?.trim()) {
        const versionSk = normalizeVersionToSk(params.sourceVersionId.trim());
        sourceVersionRow = await this.orgRepo.getOrgVersion(
          organizationId,
          sourceOrgTemplateId,
          versionSk,
        );
        if (!sourceVersionRow) {
          templateNotFoundError('Source org template version not found');
        }
      } else {
        sourceVersionRow = await this.orgRepo.getOrgVersionForMeta(
          organizationId,
          sourceOrgTemplateId,
          sourceMetaRow.meta,
        );
        if (!sourceVersionRow) {
          templateNotFoundError('Source org template version not found');
        }
      }

      await this.assertUniqueVariantName(organizationId, newTemplateName);

      const sourceOrgTemplateVersionId =
        sourceVersionRow.meta.templateVersionId ??
        sourceMetaRow.meta.templateVersionId ??
        params.sourceVersionId?.trim() ??
        '';

      const derivedFromOrgTemplateVersion = resolveTemplateDisplayVersion(
        sourceVersionRow.meta ?? sourceMetaRow.meta,
      );

      const ctx = OrgTemplateEntityBuilder.buildOrgDeriveContext(
        organizationId,
        sourceOrgTemplateId,
        sourceOrgTemplateVersionId,
        newTemplateName,
      );

      const meta = OrgTemplateEntityBuilder.buildOrgMetaFromOrgSource(
        sourceMetaRow,
        ctx,
        params.actorUser,
        derivedFromOrgTemplateVersion,
      );
      const metaRow = OrgTemplateEntityBuilder.buildOrgMetaRow(meta, organizationId, ctx.newTemplateId);
      const versionRow = OrgTemplateEntityBuilder.buildOrgVersionRowFromOrgSource(
        meta,
        ctx,
        sourceVersionRow,
      );
      appendVersionHistoryToRecord(versionRow, { isCreate: true });

      await this.orgRepo.createOrgTemplate(metaRow, versionRow);

      const masterTemplateId =
        typeof sourceMetaRow.meta.masterTemplateId === 'string'
          ? sourceMetaRow.meta.masterTemplateId.trim()
          : '';
      if (!masterTemplateId) {
        templateValidationError('Source org template is missing masterTemplateId');
      }

      const fv = asRecord(sourceVersionRow.fieldValues);
      const catalog = extractCatalogCodes(fv);
      const masterTemplateVersionId =
        typeof sourceMetaRow.meta.masterTemplateVersionId === 'string'
          ? sourceMetaRow.meta.masterTemplateVersionId
          : sourceOrgTemplateVersionId;

      const enablementId = EnablementEntityBuilder.buildEnablementId(organizationId);
      const enablementMeta = EnablementEntityBuilder.buildMetaForOrgDerived(
        {
          organizationId,
          orgTemplateId: ctx.newTemplateId,
          masterTemplateId,
          masterTemplateVersionId,
          masterTemplateVersion:
            typeof sourceMetaRow.meta.derivedFromMasterVersion === 'number'
              ? sourceMetaRow.meta.derivedFromMasterVersion
              : undefined,
          templateName: newTemplateName,
          templateType: meta.templateType,
          categoryCode: catalog.categoryCode,
          conditionCode: catalog.conditionCode,
          effectiveFrom: nowIso,
          effectiveTo: templateEnabled ? null : nowIso,
        },
        enablementId,
        nowIso,
      );
      await this.enablementRepo.putEnablement(EnablementEntityBuilder.buildRow(enablementMeta));

      return toOrgDerivedCreateResult(
        organizationId,
        sourceOrgTemplateId,
        metaRow,
        versionRow,
        templateEnabled,
      );
    } catch (e: unknown) {
      if (e instanceof OrgRulesValidationError) {
        templateValidationError(e.message);
      }
      normalizeTemplateServiceError(e);
    }
  }

  async getOrgDerived(params: ListOrgDerivedParams): Promise<GetOrgDerivedResult | ListOrgDerivedResult> {
    try {
      const organizationId = params.organizationId.trim();
      if (params.orgTemplateId?.trim()) {
        return await this.getOrgDerivedSingle(organizationId, params.orgTemplateId.trim());
      }
      return await this.listOrgDerived(params);
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async adoptOrgDerived(params: AdoptOrgDerivedParams): Promise<AdoptOrgDerivedResult> {
    try {
      if (params.confirm === false) {
        templateValidationError('confirm must be true to adopt canonical org template changes');
      }

      const organizationId = params.organizationId.trim();
      const orgTemplateId = params.orgTemplateId.trim();
      const resolved = await this.resolveOrgDerivedVariant(organizationId, orgTemplateId);
      const currentStatus = resolveMetaStatus(resolved.versionRow.meta ?? resolved.metaRow.meta);
      assertEditableStatus(currentStatus, 'adopt org-derived template');

      const sourceOrgTemplateId =
        typeof resolved.metaRow.meta.derivedFromOrgTemplateId === 'string'
          ? resolved.metaRow.meta.derivedFromOrgTemplateId.trim()
          : '';
      if (!sourceOrgTemplateId) {
        templateValidationError('Org-derived template is missing derivedFromOrgTemplateId');
      }

      const canonicalRows = await this.loadCanonicalVersionRows(organizationId, sourceOrgTemplateId);
      if (!canonicalRows.latestRow) {
        templateNotFoundError('Canonical org template not found');
      }

      const canonicalFromRow = await this.resolveCanonicalAdoptFromRow(
        organizationId,
        sourceOrgTemplateId,
        resolved.metaRow.meta,
        resolved.versionRow,
        canonicalRows.latestRow,
      );

      if (!canonicalFromRow) {
        templateConflictError('No canonical org template upgrade is available for this variant');
      }

      const adoptPreview = buildOrgDerivedAdoptPreview({
        variantMeta: resolved.metaRow.meta,
        variantVersionRow: resolved.versionRow,
        canonicalFromRow,
        canonicalToRow: canonicalRows.latestRow,
        sourceOrgTemplateId,
      });
      if (!adoptPreview?.available) {
        templateConflictError('No canonical org template upgrade is available for this variant');
      }

      const mergedDocument = mergeVariantAdoptDocument(
        resolved.versionRow,
        canonicalRows.latestRow,
        canonicalFromRow,
      );

      const toVersion = resolveTemplateDisplayVersion(canonicalRows.latestRow.meta);
      const fromVersion =
        typeof resolved.metaRow.meta.derivedFromOrgTemplateVersion === 'number'
          ? resolved.metaRow.meta.derivedFromOrgTemplateVersion
          : resolveTemplateDisplayVersion(canonicalFromRow.meta);

      const templateEnabled = resolved.enablement
        ? isActiveEnablement(resolved.enablement)
        : false;

      const versionRow = await this.orgOps.saveOrgTemplateInPlace({
        organizationId,
        templateId: orgTemplateId,
        metaRow: resolved.metaRow,
        sourceVersion: resolved.versionRow,
        mergedDocument,
        metaOverrides: {
          derivedFromOrgTemplateVersion: toVersion,
          derivedFromOrgTemplateVersionId: canonicalRows.latestRow.meta.templateVersionId,
        },
        actorUser: params.actorUser,
        bumpVersion: true,
        afterHistoryAppend: (record) => {
          applyAdoptHistoryOverride(record, {
            fromVersion,
            toVersion,
            sourceOrgTemplateId,
            actor: params.actorUser,
          });
        },
      });

      const metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
      if (!metaRow) {
        templateNotFoundError('Org-derived template not found');
      }

      return toAdoptOrgDerivedResult(
        metaRow,
        versionRow,
        templateEnabled,
        canonicalRows.metaRow?.meta,
      );
    } catch (e: unknown) {
      if (e instanceof OrgRulesValidationError) {
        templateValidationError(e.message);
      }
      normalizeTemplateServiceError(e);
    }
  }

  async updateOrgDerived(params: UpdateOrgDerivedParams): Promise<UpdateOrgDerivedResult> {
    try {
      const organizationId = params.organizationId.trim();
      const orgTemplateId = params.orgTemplateId.trim();
      const ruleKeys = Object.keys(params.rules ?? {});
      const hasFieldValues = hasFieldValuesPatch(params.fieldValues);
      const hasEnablePatch = params.templateEnabled !== undefined;
      const hasStatusPatch = params.status !== undefined;
      const hasActivePatch = params.active !== undefined;
      const nowIso = new Date().toISOString();

      if (
        ruleKeys.length === 0 &&
        !hasFieldValues &&
        !hasEnablePatch &&
        !hasStatusPatch &&
        !hasActivePatch
      ) {
        templateValidationError(
          'rules, fieldValues, templateEnabled, status, or active must be provided',
        );
      }

      const resolved = await this.resolveOrgDerivedVariant(organizationId, orgTemplateId);
      let versionRow = resolved.versionRow;
      let metaRow = resolved.metaRow;
      let templateEnabled = resolved.enablement
        ? isActiveEnablement(resolved.enablement)
        : false;

      if (hasEnablePatch && params.templateEnabled !== undefined) {
        templateEnabled = await this.applyVariantEnablement(
          resolved.enablement,
          organizationId,
          orgTemplateId,
          resolved.metaRow,
          versionRow,
          params.templateEnabled,
        );
      }

      const currentStatus = resolveMetaStatus(versionRow.meta ?? metaRow.meta);
      const metaOverrides = buildOrgDerivedMetaOverrides({
        status: params.status,
        active: params.active,
        currentMeta: metaRow.meta,
        nowIso,
      });
      const hasMetaPatch = hasStatusPatch || hasActivePatch;
      const contentPatch = ruleKeys.length > 0 || hasFieldValues;

      if (contentPatch) {
        const statusForEdit =
          params.status === TEMPLATE_STATUS.DRAFT ? TEMPLATE_STATUS.DRAFT : currentStatus;
        assertEditableStatus(statusForEdit, 'update org-derived template');

        const mergedDocument = {
          ...this.orgOps.extractDocumentFields(versionRow),
        };

        if (hasFieldValues) {
          mergedDocument.fieldValues = {
            ...asRecord(versionRow.fieldValues),
            ...params.fieldValues,
          };
        }

        const templateType = versionRow.meta?.templateType ?? metaRow.meta.templateType;

        let nextRules = asTemplateRulesMap(versionRow.rules);
        if (hasFieldValues) {
          nextRules = mergeRulesAfterFieldValuesChange(
            asRecord(versionRow.rules),
            buildRulesFromFieldValues(asRecord(mergedDocument.fieldValues), { templateType }),
            {
              templateType,
              fieldValues: asRecord(mergedDocument.fieldValues),
              previousFieldValues: asRecord(versionRow.fieldValues),
            },
          );
        }

        if (ruleKeys.length > 0) {
          nextRules = mergeOrgRulesPartial(nextRules, params.rules!);
        }

        mergedDocument.rules = nextRules;

        versionRow = await this.orgOps.saveOrgTemplateInPlace({
          organizationId,
          templateId: orgTemplateId,
          metaRow,
          sourceVersion: versionRow,
          mergedDocument,
          metaOverrides: {
            ...metaOverrides,
            status: (params.status ?? currentStatus) as TemplateStatus,
          },
          actorUser: params.actorUser,
          bumpVersion: true,
        });
        metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
        if (!metaRow) {
          templateNotFoundError('Org-derived template not found');
        }
      } else if (hasMetaPatch) {
        versionRow = await this.orgOps.saveOrgTemplateInPlace({
          organizationId,
          templateId: orgTemplateId,
          metaRow,
          sourceVersion: versionRow,
          mergedDocument: this.orgOps.extractDocumentFields(versionRow),
          metaOverrides,
          actorUser: params.actorUser,
          bumpVersion: false,
        });
        metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
        if (!metaRow) {
          templateNotFoundError('Org-derived template not found');
        }
      }

      return toUpdateOrgDerivedResult(metaRow, versionRow, templateEnabled);
    } catch (e: unknown) {
      if (e instanceof OrgRulesValidationError) {
        templateValidationError(e.message);
      }
      normalizeTemplateServiceError(e);
    }
  }

  private async getOrgDerivedSingle(
    organizationId: string,
    orgTemplateId: string,
  ): Promise<GetOrgDerivedResult> {
    const resolved = await this.resolveOrgDerivedVariant(organizationId, orgTemplateId);
    const sourceOrgTemplateId =
      typeof resolved.metaRow.meta.derivedFromOrgTemplateId === 'string'
        ? resolved.metaRow.meta.derivedFromOrgTemplateId.trim()
        : '';

    const canonicalMeta = sourceOrgTemplateId
      ? (await this.orgRepo.getOrgMeta(organizationId, sourceOrgTemplateId))?.meta
      : undefined;

    let adoptContext: {
      canonicalFromRow?: TemplateDdbRecord;
      canonicalToRow?: TemplateDdbRecord;
    } | undefined;

    if (sourceOrgTemplateId && canonicalMeta) {
      const canonicalRows = await this.loadCanonicalVersionRows(organizationId, sourceOrgTemplateId);
      const canonicalFromRow =
        canonicalRows.latestRow &&
        (await this.resolveCanonicalAdoptFromRow(
          organizationId,
          sourceOrgTemplateId,
          resolved.metaRow.meta,
          resolved.versionRow,
          canonicalRows.latestRow,
        ));

      adoptContext = {
        canonicalFromRow: canonicalFromRow ?? undefined,
        canonicalToRow: canonicalRows.latestRow ?? undefined,
      };
    }

    return toOrgDerivedDetail(
      organizationId,
      resolved.metaRow,
      resolved.versionRow,
      resolved.enablement,
      canonicalMeta,
      adoptContext,
    );
  }

  private async listOrgDerived(params: ListOrgDerivedParams): Promise<ListOrgDerivedResult> {
    const organizationId = params.organizationId.trim();
    const limit = DEFAULT_TEMPLATE_LIST_PAGE_SIZE;
    const offset = decodeOffsetToken(params.nextToken);

    const organizationMeta = await this.resolveStoredOrganizationMeta(organizationId);
    const allRows = await this.loadOrgDerivedRows(organizationId);
    const filterOptions = buildOrgDerivedFilterOptions(allRows);

    const filtered = await this.filterOrgDerivedRows(allRows, params);
    const pageItems = filtered.slice(offset, offset + limit);
    const hasMore = offset + limit < filtered.length;
    const nextToken = hasMore ? encodeListCursor({ o: offset + limit }) : undefined;

    const canonicalMetaById = await this.loadCanonicalMetaMap(
      organizationId,
      pageItems.map((row) => row.metaRow),
    );

    const versionRowsByTemplateId = await this.loadVersionRowsByTemplateId(
      organizationId,
      pageItems.map((row) => row.metaRow.meta.templateId),
    );

    const items = pageItems.map((row) => {
      const sourceId =
        typeof row.metaRow.meta.derivedFromOrgTemplateId === 'string'
          ? row.metaRow.meta.derivedFromOrgTemplateId
          : undefined;
      const allVersions = versionRowsByTemplateId.get(row.metaRow.meta.templateId) ?? [];
      const history = resolveOrgDerivedItemHistory(row.versionRow, allVersions);
      return toOrgDerivedListItem(
        row.metaRow,
        row.versionRow,
        row.enablement,
        sourceId ? canonicalMetaById.get(sourceId) : undefined,
        history,
      );
    });

    return {
      organizationMeta,
      items,
      filterOptions,
      pagination: {
        limit,
        count: items.length,
        total: filtered.length,
        hasMore,
        nextToken,
      },
    };
  }

  private async loadOrgDerivedRows(organizationId: string): Promise<OrgDerivedRow[]> {
    const rows: OrgDerivedRow[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const page = await this.orgRepo.queryOrgTemplatesGsi1Page(
        { organizationId },
        { limit: 100, exclusiveStartKey },
      );

      for (const item of page.items) {
        if (item.sk !== TEMPLATE_META_SK) continue;
        if (!isOrgDerivedVariant(item.meta)) continue;

        const versionRow = await this.orgRepo.getOrgVersionForMeta(
          organizationId,
          item.meta.templateId,
          item.meta,
        );
        if (!versionRow) continue;

        const enablement = await this.enablementRepo.findByOrgAndOrgTemplateId(
          organizationId,
          item.meta.templateId,
        );

        rows.push({ metaRow: item, versionRow, enablement });
      }

      exclusiveStartKey = page.lastEvaluatedKey;
    } while (exclusiveStartKey);

    return rows;
  }

  private async loadCanonicalVersionRows(
    organizationId: string,
    sourceOrgTemplateId: string,
  ): Promise<{
    metaRow: TemplateDdbRecord | null;
    latestRow: TemplateDdbRecord | null;
  }> {
    const metaRow = await this.orgRepo.getOrgMeta(organizationId, sourceOrgTemplateId);
    if (!metaRow) {
      return { metaRow: null, latestRow: null };
    }
    const latestRow = await this.orgRepo.getOrgVersionForMeta(
      organizationId,
      sourceOrgTemplateId,
      metaRow.meta,
    );
    return { metaRow, latestRow };
  }

  private async loadOrgVersionByTemplateVersionId(
    organizationId: string,
    templateId: string,
    templateVersionId: string,
  ): Promise<TemplateDdbRecord | null> {
    const versionSk = normalizeVersionToSk(templateVersionId);
    return this.orgRepo.getOrgVersion(organizationId, templateId, versionSk);
  }

  private async resolveCanonicalAdoptFromRow(
    organizationId: string,
    sourceOrgTemplateId: string,
    variantMeta: TemplateDdbRecord['meta'],
    variantVersionRow: TemplateDdbRecord,
    latestRow: TemplateDdbRecord,
  ): Promise<TemplateDdbRecord | null> {
    const fromVersionId =
      typeof variantMeta.derivedFromOrgTemplateVersionId === 'string'
        ? variantMeta.derivedFromOrgTemplateVersionId.trim()
        : '';
    const snapshotVersion =
      typeof variantMeta.derivedFromOrgTemplateVersion === 'number'
        ? variantMeta.derivedFromOrgTemplateVersion
        : fromVersionId
          ? resolveTemplateDisplayVersion({ templateVersionId: fromVersionId })
          : 0;

    if (!snapshotVersion) {
      return null;
    }

    const rowAtVersionId = fromVersionId
      ? await this.loadOrgVersionByTemplateVersionId(
          organizationId,
          sourceOrgTemplateId,
          fromVersionId,
        )
      : null;

    return resolveCanonicalSnapshotRow({
      latestRow,
      snapshotVersion,
      snapshotVersionId: fromVersionId || undefined,
      rowAtVersionId,
      variantVersionRow,
    });
  }

  private async loadVersionRowsByTemplateId(
    organizationId: string,
    templateIds: string[],
  ): Promise<Map<string, TemplateDdbRecord[]>> {
    const uniqueIds = [...new Set(templateIds.filter(Boolean))];
    const map = new Map<string, TemplateDdbRecord[]>();

    await Promise.all(
      uniqueIds.map(async (templateId) => {
        const { items } = await this.orgRepo.listOrgVersions({
          organizationId,
          templateId,
        });
        map.set(templateId, items);
      }),
    );

    return map;
  }

  private async loadCanonicalMetaForVariant(
    organizationId: string,
    variantMeta: TemplateDdbRecord['meta'],
  ): Promise<TemplateDdbRecord['meta'] | undefined> {
    const sourceId =
      typeof variantMeta.derivedFromOrgTemplateId === 'string'
        ? variantMeta.derivedFromOrgTemplateId.trim()
        : '';
    if (!sourceId) return undefined;
    const row = await this.orgRepo.getOrgMeta(organizationId, sourceId);
    return row?.meta;
  }

  private async loadCanonicalMetaMap(
    organizationId: string,
    variantMetaRows: TemplateDdbRecord[],
  ): Promise<Map<string, TemplateDdbRecord['meta']>> {
    const ids = [
      ...new Set(
        variantMetaRows
          .map((row) =>
            typeof row.meta.derivedFromOrgTemplateId === 'string'
              ? row.meta.derivedFromOrgTemplateId.trim()
              : '',
          )
          .filter(Boolean),
      ),
    ];

    const map = new Map<string, TemplateDdbRecord['meta']>();
    await Promise.all(
      ids.map(async (id) => {
        const row = await this.orgRepo.getOrgMeta(organizationId, id);
        if (row?.meta) {
          map.set(id, row.meta);
        }
      }),
    );
    return map;
  }

  private async filterOrgDerivedRows(
    rows: OrgDerivedRow[],
    params: ListOrgDerivedParams,
  ): Promise<OrgDerivedRow[]> {
    const conditionFilter = params.conditionCode ?? params.condition;
    const nameFilter = params.templateName?.trim().toLowerCase();

    const filtered: OrgDerivedRow[] = [];
    for (const row of rows) {
      const fv = asRecord(row.versionRow.fieldValues);
      const catalog = extractCatalogCodes(fv);

      if (params.categoryCode && !eqCi(catalog.categoryCode, params.categoryCode)) continue;
      if (conditionFilter && !eqCi(catalog.conditionCode, conditionFilter)) continue;
      if (params.templateType && !eqCi(row.metaRow.meta.templateType, params.templateType)) continue;

      if (params.specialty?.trim()) {
        const specs = Array.isArray(row.metaRow.meta.specialty)
          ? row.metaRow.meta.specialty.map(String)
          : catalog.specialty
            ? [catalog.specialty]
            : [];
        if (!specs.some((s) => eqCi(s, params.specialty))) continue;
      }

      if (nameFilter) {
        const name = row.metaRow.meta.templateName?.trim().toLowerCase() ?? '';
        if (!name.includes(nameFilter)) continue;
      }

      if (params.templateEnabled !== undefined) {
        const enabled = row.enablement ? isActiveEnablement(row.enablement) : false;
        if (enabled !== params.templateEnabled) continue;
      }

      filtered.push(row);
    }

    return filtered;
  }

  private async resolveOrgDerivedVariant(
    organizationId: string,
    orgTemplateId: string,
  ): Promise<OrgDerivedRow> {
    const metaRow = await this.orgRepo.getOrgMeta(organizationId, orgTemplateId);
    if (!metaRow || !isOrgDerivedVariant(metaRow.meta)) {
      templateNotFoundError('Org-derived template not found');
    }

    const versionRow = await this.orgRepo.getOrgVersionForMeta(
      organizationId,
      orgTemplateId,
      metaRow.meta,
    );
    if (!versionRow) {
      templateNotFoundError('Org-derived template version not found');
    }

    const enablement = await this.enablementRepo.findByOrgAndOrgTemplateId(
      organizationId,
      orgTemplateId,
    );

    return { metaRow, versionRow, enablement };
  }

  private async assertUniqueVariantName(
    organizationId: string,
    newTemplateName: string,
  ): Promise<void> {
    const rows = await this.loadOrgDerivedRows(organizationId);
    const normalized = newTemplateName.trim().toLowerCase();
    const duplicate = rows.some(
      (row) => row.metaRow.meta.templateName?.trim().toLowerCase() === normalized,
    );
    if (duplicate) {
      templateConflictError(
        `An org-derived template named "${newTemplateName}" already exists for this organization`,
      );
    }
  }

  private async applyVariantEnablement(
    existing: EnablementDdbRecord | null,
    organizationId: string,
    orgTemplateId: string,
    metaRow: TemplateDdbRecord,
    versionRow: TemplateDdbRecord,
    wantEnabled: boolean,
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();

    if (!existing) {
      const masterTemplateId =
        typeof metaRow.meta.masterTemplateId === 'string'
          ? metaRow.meta.masterTemplateId.trim()
          : '';
      if (!masterTemplateId) {
        templateValidationError('Org-derived template is missing masterTemplateId');
      }

      const fv = asRecord(versionRow.fieldValues);
      const catalog = extractCatalogCodes(fv);
      const enablementId = EnablementEntityBuilder.buildEnablementId(organizationId);
      const enablementMeta = EnablementEntityBuilder.buildMetaForOrgDerived(
        {
          organizationId,
          orgTemplateId,
          masterTemplateId,
          masterTemplateVersionId:
            metaRow.meta.templateVersionId ?? versionRow.meta.templateVersionId ?? '',
          templateName: metaRow.meta.templateName ?? orgTemplateId,
          templateType: metaRow.meta.templateType,
          categoryCode: catalog.categoryCode,
          conditionCode: catalog.conditionCode,
          effectiveFrom: nowIso,
          effectiveTo: wantEnabled ? null : nowIso,
        },
        enablementId,
        nowIso,
      );
      await this.enablementRepo.putEnablement(EnablementEntityBuilder.buildRow(enablementMeta));
      return wantEnabled;
    }

    if (wantEnabled && isActiveEnablement(existing)) {
      return true;
    }
    if (!wantEnabled && !isActiveEnablement(existing)) {
      return false;
    }

    const updated = EnablementEntityBuilder.applyDateUpdates(existing, {
      effectiveTo: wantEnabled ? null : nowIso,
      ...(wantEnabled ? { effectiveFrom: nowIso } : {}),
    });
    updated.meta.updatedAt = nowIso;
    await this.enablementRepo.putEnablementOverwrite(updated);
    return wantEnabled;
  }

  private async resolveStoredOrganizationMeta(organizationId: string): Promise<OrganizationMeta> {
    const profile = await this.orgProfileRepo.getOrgProfile(organizationId);
    const stored = profile?.meta;
    return {
      id: organizationId,
      name: stored?.name?.trim() || organizationId,
      active: stored?.active,
      country: stored?.country,
      updated: stored?.updated,
      description: stored?.description ?? null,
    };
  }

  private async upsertOrganizationProfile(input: OrganizationMeta): Promise<void> {
    const meta: OrgProfileMeta = {
      id: input.id.trim(),
      name: (input.name?.trim() || input.id).trim(),
      active: input.active,
      country: input.country?.trim(),
      updated:
        input.updated === undefined || input.updated === null
          ? new Date().toISOString()
          : String(input.updated).trim() || new Date().toISOString(),
      description: input.description ?? null,
    };
    await this.orgProfileRepo.putOrgProfile(meta);
  }
}
