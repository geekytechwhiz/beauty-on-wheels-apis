import { extractCatalogCodes } from '../utils/field-values-profile.utils';
import { asTemplateRulesMap } from '../utils/template-rules.utils';
import { resolveTemplateDisplayVersion } from '../utils/template.utils';
import type { EnablementDdbRecord } from '../models/api/enablement.types';
import type {
  OrgDerivedCreateResult,
  GetOrgDerivedResult,
  OrgDerivedFilterOption,
  OrgDerivedFilterOptions,
  OrgDerivedListItem,
  UpdateOrgDerivedResult,
} from '../models/api/org-derived.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { isActiveEnablement } from '../utils/enablement.utils';

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
): OrgDerivedListItem {
  const meta = metaRow.meta;
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
    templateEnabled: enablement ? isActiveEnablement(enablement) : false,
    lastModifiedAt: meta.lastModifiedAt,
  };
}

export function toOrgDerivedDetail(
  organizationId: string,
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
  enablement: EnablementDdbRecord | null,
): GetOrgDerivedResult {
  const base = toOrgDerivedListItem(metaRow, versionRow, enablement);
  const meta = metaRow.meta;

  return {
    ...base,
    organizationId,
    derivedFromOrgTemplateVersionId:
      typeof meta.derivedFromOrgTemplateVersionId === 'string'
        ? meta.derivedFromOrgTemplateVersionId
        : undefined,
    fieldValues: fieldValuesOf(versionRow),
    rules: asTemplateRulesMap(versionRow.rules),
  };
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
    templateEnabled,
    version: resolveTemplateDisplayVersion(meta),
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
    templateEnabled,
    fieldValues: fieldValuesOf(versionRow),
    rules: asTemplateRulesMap(versionRow.rules),
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
