import { TEMPLATE_STATUS } from '../constants/template.constants';
import {
  buildVersionHistory,
  resolveTemplateHistory,
  toListHistorySummary,
  type TemplateHistoryEntry,
} from '../mappers/template-http.dto';
import { extractCatalogCodes } from '../utils/field-values-profile.utils';
import { asTemplateRulesMap } from '../utils/template-rules.utils';
import { buildOrgDerivedAdoptPreview } from '../utils/org-derived-adopt.utils';
import { compareTemplateDisplayVersions, resolveTemplateDisplayVersion } from '../utils/template.utils';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type {
  OrgDerivedCreateResult,
  GetOrgDerivedResult,
  OrgDerivedAdoptPreview,
  OrgDerivedFilterOption,
  OrgDerivedFilterOptions,
  OrgDerivedListItem,
  AdoptOrgDerivedResult,
  UpdateOrgDerivedResult,
} from '../models/api/org-derived.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { isActiveEnablement } from '../utils/enablement.utils';

function resolveOrgDerivedUpgrade(
  variantMeta: TemplateDdbRecord['meta'],
  canonicalMeta: TemplateDdbRecord['meta'] | undefined,
): boolean {
  if (!canonicalMeta) return false;
  const derivedFromVersion =
    typeof variantMeta.derivedFromOrgTemplateVersion === 'number'
      ? variantMeta.derivedFromOrgTemplateVersion
      : resolveTemplateDisplayVersion({
          templateVersionId:
            typeof variantMeta.derivedFromOrgTemplateVersionId === 'string'
              ? variantMeta.derivedFromOrgTemplateVersionId
              : undefined,
        });
  if (!derivedFromVersion) return false;
  const canonicalVersion = resolveTemplateDisplayVersion(canonicalMeta);
  return compareTemplateDisplayVersions(canonicalVersion, derivedFromVersion) > 0;
}

function fieldValuesOf(record: TemplateDdbRecord): Record<string, unknown> {
  const fv = record['fieldValues'];
  return fv && typeof fv === 'object' && !Array.isArray(fv) ? (fv as Record<string, unknown>) : {};
}

function extractFilterLabel(fieldValues: Record<string, unknown>, fieldKey: string, code: string): string {
  const raw = fieldValues[fieldKey];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const labelKey = (raw as Record<string, unknown>).labelKey;
    if (typeof labelKey === 'string' && labelKey.trim()) {
      return labelKey.trim();
    }
  }
  return code;
}

function resolveSpecialty(meta: TemplateDdbRecord['meta'], fieldValues: Record<string, unknown>): string[] {
  if (Array.isArray(meta.specialty) && meta.specialty.length > 0) {
    return meta.specialty.map(String);
  }
  const catalog = extractCatalogCodes(fieldValues);
  return catalog.specialty ? [catalog.specialty] : [];
}

export function toOrgDerivedListItem(
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
  enablement: EnablementDdbRecord | null,
  canonicalMeta?: TemplateDdbRecord['meta'],
  history?: TemplateHistoryEntry[],
): OrgDerivedListItem {
  const meta = metaRow.meta;
  const versionMeta = versionRow.meta ?? meta;
  const fv = fieldValuesOf(versionRow);
  const catalog = extractCatalogCodes(fv);

  return {
    orgTemplateId: meta.templateId,
    templateName: meta.templateName,
    templateType: meta.templateType,
    masterTemplateId:
      typeof meta.masterTemplateId === 'string' ? meta.masterTemplateId : undefined,
    categoryCode: catalog.categoryCode,
    conditionCode: catalog.conditionCode,
    specialty: resolveSpecialty(meta, fv),
    version: resolveTemplateDisplayVersion(meta),
    templateVersionId: meta.templateVersionId ?? '',
    derivedFromOrgTemplateId:
      typeof meta.derivedFromOrgTemplateId === 'string'
        ? meta.derivedFromOrgTemplateId
        : undefined,
    derivedFromOrgTemplateVersionId:
      typeof meta.derivedFromOrgTemplateVersionId === 'string'
        ? meta.derivedFromOrgTemplateVersionId
        : undefined,
    derivedFromOrgTemplateVersion:
      typeof meta.derivedFromOrgTemplateVersion === 'number'
        ? meta.derivedFromOrgTemplateVersion
        : undefined,
    status: versionMeta.status ?? TEMPLATE_STATUS.DRAFT,
    active: versionMeta.isActive !== false,
    templateEnabled: enablement ? isActiveEnablement(enablement) : false,
    upgrade: resolveOrgDerivedUpgrade(meta, canonicalMeta),
    lastModifiedAt: meta.lastModifiedAt,
    history: history ?? [],
  };
}

export function toOrgDerivedDetail(
  organizationId: string,
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
  enablement: EnablementDdbRecord | null,
  canonicalMeta?: TemplateDdbRecord['meta'],
  adoptContext?: {
    canonicalFromRow?: TemplateDdbRecord;
    canonicalToRow?: TemplateDdbRecord;
  },
): GetOrgDerivedResult {
  const history = resolveOrgDerivedItemHistory(versionRow);
  const base = toOrgDerivedListItem(metaRow, versionRow, enablement, canonicalMeta, history);
  const meta = metaRow.meta;

  let adopt: OrgDerivedAdoptPreview | null = null;
  if (
    base.upgrade &&
    adoptContext?.canonicalFromRow &&
    adoptContext?.canonicalToRow &&
    typeof meta.derivedFromOrgTemplateId === 'string'
  ) {
    adopt = buildOrgDerivedAdoptPreview({
      variantMeta: meta,
      variantVersionRow: versionRow,
      canonicalFromRow: adoptContext.canonicalFromRow,
      canonicalToRow: adoptContext.canonicalToRow,
      sourceOrgTemplateId: meta.derivedFromOrgTemplateId,
    });
  }

  return {
    ...base,
    organizationId,
    derivedFromOrgTemplateVersionId:
      typeof meta.derivedFromOrgTemplateVersionId === 'string'
        ? meta.derivedFromOrgTemplateVersionId
        : undefined,
    fieldValues: fieldValuesOf(versionRow),
    rules: asTemplateRulesMap(versionRow.rules),
    adopt,
  };
}

export function resolveOrgDerivedItemHistory(
  versionRow: TemplateDdbRecord,
  allVersionRows: TemplateDdbRecord[] = [],
): TemplateHistoryEntry[] {
  const resolved = resolveTemplateHistory(versionRow, allVersionRows);
  if (resolved.length > 0) {
    return resolved;
  }
  // In-place org-derived variants use one VERSION row; synthesize one entry for legacy rows.
  if (versionRow.meta?.templateId) {
    return toListHistorySummary(buildVersionHistory([versionRow]));
  }
  return [];
}

export function toOrgDerivedCreateResult(
  organizationId: string,
  sourceOrgTemplateId: string,
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
  templateEnabled: boolean,
): OrgDerivedCreateResult {
  const meta = metaRow.meta;
  const fv = fieldValuesOf(versionRow);
  const catalog = extractCatalogCodes(fv);

  return {
    organizationId,
    sourceOrgTemplateId,
    orgTemplateId: meta.templateId,
    templateVersionId: meta.templateVersionId ?? '',
    templateName: meta.templateName ?? meta.templateId,
    masterTemplateId:
      typeof meta.masterTemplateId === 'string' ? meta.masterTemplateId : undefined,
    templateType: meta.templateType,
    categoryCode: catalog.categoryCode,
    conditionCode: catalog.conditionCode,
    status: meta.status ?? TEMPLATE_STATUS.DRAFT,
    active: meta.isActive !== false,
    templateEnabled,
    version: resolveTemplateDisplayVersion(meta),
  };
}

export function toAdoptOrgDerivedResult(
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
  templateEnabled: boolean,
  canonicalMeta?: TemplateDdbRecord['meta'],
): AdoptOrgDerivedResult {
  const meta = versionRow.meta ?? metaRow.meta;
  const lineageMeta = metaRow.meta;
  const history = resolveOrgDerivedItemHistory(versionRow);

  return {
    orgTemplateId: meta.templateId,
    templateVersionId: meta.templateVersionId ?? '',
    templateName: meta.templateName,
    version: resolveTemplateDisplayVersion(meta),
    derivedFromOrgTemplateVersion:
      typeof lineageMeta.derivedFromOrgTemplateVersion === 'number'
        ? lineageMeta.derivedFromOrgTemplateVersion
        : resolveTemplateDisplayVersion(meta),
    derivedFromOrgTemplateVersionId:
      typeof lineageMeta.derivedFromOrgTemplateVersionId === 'string'
        ? lineageMeta.derivedFromOrgTemplateVersionId
        : meta.templateVersionId ?? '',
    status: meta.status ?? TEMPLATE_STATUS.DRAFT,
    active: meta.isActive !== false,
    templateEnabled,
    upgrade: resolveOrgDerivedUpgrade(lineageMeta, canonicalMeta),
    adopt: null,
    fieldValues: fieldValuesOf(versionRow),
    rules: asTemplateRulesMap(versionRow.rules),
    history,
  };
}

export function toUpdateOrgDerivedResult(
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
  templateEnabled: boolean,
): UpdateOrgDerivedResult {
  const meta = versionRow.meta ?? metaRow.meta;

  return {
    orgTemplateId: meta.templateId,
    templateVersionId: meta.templateVersionId ?? '',
    templateName: meta.templateName,
    version: resolveTemplateDisplayVersion(meta),
    status: meta.status ?? TEMPLATE_STATUS.DRAFT,
    active: meta.isActive !== false,
    templateEnabled,
    fieldValues: fieldValuesOf(versionRow),
    rules: asTemplateRulesMap(versionRow.rules),
    history: resolveOrgDerivedItemHistory(versionRow),
  };
}

export function buildOrgDerivedFilterOptions(
  items: Array<{ metaRow: TemplateDdbRecord; versionRow: TemplateDdbRecord }>,
): OrgDerivedFilterOptions {
  const categoryCode = new Map<string, OrgDerivedFilterOption>();
  const conditionCode = new Map<string, OrgDerivedFilterOption>();
  const specialty = new Map<string, OrgDerivedFilterOption>();

  for (const { metaRow, versionRow } of items) {
    const fv = fieldValuesOf(versionRow);
    const catalog = extractCatalogCodes(fv);

    if (catalog.categoryCode) {
      categoryCode.set(catalog.categoryCode, {
        key: catalog.categoryCode,
        label: extractFilterLabel(fv, 'Category', catalog.categoryCode),
      });
    }
    if (catalog.conditionCode) {
      conditionCode.set(catalog.conditionCode, {
        key: catalog.conditionCode,
        label: extractFilterLabel(fv, 'Condition', catalog.conditionCode),
      });
    }
    for (const spec of resolveSpecialty(metaRow.meta, fv)) {
      specialty.set(spec, { key: spec, label: spec });
    }
  }

  const sortByKey = (a: OrgDerivedFilterOption, b: OrgDerivedFilterOption) =>
    a.key.localeCompare(b.key);

  return {
    categoryCode: [...categoryCode.values()].sort(sortByKey),
    conditionCode: [...conditionCode.values()].sort(sortByKey),
    specialty: [...specialty.values()].sort(sortByKey),
  };
}
