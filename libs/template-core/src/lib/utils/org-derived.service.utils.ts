import {
  DERIVATION_KIND,
  MASTER_CATALOG_TEMPLATE_TYPES,
  ORG_EDITABLE_STATUSES,
  TEMPLATE_STATUS,
  TEMPLATE_TYPE_CARE_PLAN,
  type TemplateStatus,
} from '../constants/template.constants';
import { TemplateEntityBuilder } from '../builder/template-entity.builder';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { decodeListCursor, templateConflictError } from './template.utils';

const NON_CARE_PLAN_TEMPLATE_TYPES = new Set<string>(
  MASTER_CATALOG_TEMPLATE_TYPES.filter((type) => type !== TEMPLATE_TYPE_CARE_PLAN),
);

export function eqCi(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export function matchesOrgDerivedTemplateType(
  rowType: string | undefined,
  filterType: string,
): boolean {
  if (!rowType?.trim() || !filterType?.trim()) return false;
  const normalizedRow = TemplateEntityBuilder.normalizeTemplateType(rowType);
  const normalizedFilter = TemplateEntityBuilder.normalizeTemplateType(filterType);
  if (normalizedRow === normalizedFilter) return true;
  if (normalizedFilter === TEMPLATE_TYPE_CARE_PLAN) {
    if (NON_CARE_PLAN_TEMPLATE_TYPES.has(normalizedRow)) {
      return false;
    }
    return (
      normalizedRow === TEMPLATE_TYPE_CARE_PLAN ||
      normalizedRow.startsWith(`${TEMPLATE_TYPE_CARE_PLAN}_`)
    );
  }
  return false;
}

export function decodeOrgDerivedListOffset(token: string | undefined): number {
  const decoded = decodeListCursor(token);
  const offset = decoded?.o;
  return typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

export function asOrgDerivedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function hasFieldValuesPatch(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function assertOrgDerivedEditableStatus(status: TemplateStatus | undefined, action: string): void {
  if (!status || !ORG_EDITABLE_STATUSES.includes(status)) {
    templateConflictError(
      `Cannot ${action} org template in status ${status ?? 'UNKNOWN'}; only DRAFT, SAVED, or IN_REVIEW are editable`,
    );
  }
}

export function buildOrgDerivedMetaOverrides(params: {
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

export function resolveOrgDerivedMetaStatus(meta: TemplateDdbRecord['meta']): TemplateStatus {
  return (meta.status ?? TEMPLATE_STATUS.DRAFT) as TemplateStatus;
}

export function isOrgDerivedVariant(meta: TemplateDdbRecord['meta']): boolean {
  return meta.derivationKind === DERIVATION_KIND.ORG_DERIVE;
}

export function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
