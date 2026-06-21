import {
  isLinkedTemplateFieldKey,
  LINKED_TEMPLATE_CONSOLE_KEYS,
} from '../constants/template.constants';
import { firstString } from './template.utils';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Console select: `{ labelKey, value }` → returns `value` as string when present. */
export function extractLabelValue(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const value = raw.value;
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export type FieldValuesCatalogProfile = {
  categoryCode?: string;
  conditionCode?: string;
  country?: string;
  language?: string;
  specialty?: string;
  shareScope?: string;
};

/** Catalog codes for meta, GSI, filterOptions, and derive matching. */
export function extractCatalogCodes(fieldValues: Record<string, unknown>): FieldValuesCatalogProfile {
  const fv = fieldValues ?? {};
  return {
    categoryCode:
      extractLabelValue(fv.Category) ??
      firstString(fv.CATEGORY) ??
      firstString(fv.categoryCode) ??
      firstString(fv.category),
    conditionCode:
      extractLabelValue(fv.Condition) ??
      firstString(fv.CONDITION) ??
      firstString(fv.conditionCode) ??
      firstString(fv.condition),
    country:
      extractLabelValue(fv.Country) ??
      firstString(fv.COUNTRY) ??
      firstString(fv.country),
    language:
      extractLabelValue(fv.Language) ??
      firstString(fv.LANGUAGE) ??
      firstString(fv.language),
    specialty:
      extractLabelValue(fv.Specialty) ??
      firstString(fv.SPECIALITY) ??
      firstString(fv.SPECIALTY) ??
      firstString(fv.specialty),
    shareScope:
      extractLabelValue(fv.SelectScope) ??
      firstString(fv.SELECT_SCOPE) ??
      firstString(fv.shareScope),
  };
}

export function resolveTemplateDisplayName(
  body?: Record<string, unknown>,
  fieldValues?: Record<string, unknown>,
): string | undefined {
  const b = body ?? {};
  const fv = fieldValues ?? {};
  const templateMetadata =
    b.templateMetadata && isPlainObject(b.templateMetadata)
      ? (b.templateMetadata as Record<string, unknown>)
      : {};

  return (
    firstString(b.templateName) ??
    firstString(b.TEMPLATE_NAME) ??
    firstString(b.TemplateName) ??
    firstString(templateMetadata.templateName) ??
    firstString(fv.TEMPLATE_NAME) ??
    firstString(fv.TemplateName) ??
    firstString(fv.templateName) ??
    firstString(fv.TASK_NAME)
  );
}

export function isLabelValueObject(
  value: unknown,
): value is { labelKey?: string; value: unknown } {
  if (!isPlainObject(value) || !('value' in value)) {
    return false;
  }
  return Object.keys(value).every((key) => key === 'labelKey' || key === 'value');
}

/** Array of console select options — no nested rule children. */
export function isLabelValueOnlyArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isLabelValueObject(item))
  );
}

/**
 * Normalizes a linked-template field value for rules walk.
 * `null` / `[]` → undefined (container only). Single card object → that object.
 */
export function normalizeLinkValueForRules(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined;
    }
    const first = value[0];
    return isPlainObject(first) ? first : undefined;
  }
  if (typeof value === 'string' && !value.trim()) {
    return undefined;
  }
  if (isPlainObject(value)) {
    if (isLabelValueObject(value) || Object.keys(value).length === 0) {
      return undefined;
    }
    return value;
  }
  return undefined;
}

export function collectCarePlanLinkedFieldKeys(fieldValues: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(fieldValues).filter(isLinkedTemplateFieldKey));
}

export { LINKED_TEMPLATE_CONSOLE_KEYS };
