export const TEMPLATE_RULE_METADATA_MODE_FIXED = 'Fixed' as const;

export type TemplateRuleMetadataMode = typeof TEMPLATE_RULE_METADATA_MODE_FIXED;

export interface TemplateFieldRule {
  enable: boolean;
  orgedit: boolean;
  add: boolean;
  defaultedit: boolean;
  delete: boolean;
  metadataMode: TemplateRuleMetadataMode;
  min: number;
  max: number;
}

export type TemplateRulesMap = Record<string, TemplateFieldRule>;

export const TEMPLATE_FIELD_RULE_BOOLEAN_KEYS = [
  'enable',
  'orgedit',
  'add',
  'defaultedit',
  'delete',
] as const;

export type TemplateFieldRuleBooleanKey = (typeof TEMPLATE_FIELD_RULE_BOOLEAN_KEYS)[number];

export const TEMPLATE_FIELD_RULE_PATCH_KEYS = [
  ...TEMPLATE_FIELD_RULE_BOOLEAN_KEYS,
  'metadataMode',
  'min',
  'max',
] as const;

export type TemplateFieldRulePatchKey = (typeof TEMPLATE_FIELD_RULE_PATCH_KEYS)[number];

/** @deprecated Use {@link TEMPLATE_FIELD_RULE_BOOLEAN_KEYS} */
export const TEMPLATE_FIELD_RULE_KEYS = TEMPLATE_FIELD_RULE_BOOLEAN_KEYS;

/** @deprecated Use {@link TemplateFieldRuleBooleanKey} */
export type TemplateFieldRuleKey = TemplateFieldRuleBooleanKey;

export type PartialTemplateFieldRule = Partial<TemplateFieldRule>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isArrayOfObjects(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && isPlainObject(value[0]);
}

function expandObjectKeys(obj: Record<string, unknown>, paths: Set<string>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (isArrayOfObjects(value)) {
      paths.add(key);
      expandObjectKeys(value[0], paths);
    } else if (isPlainObject(value)) {
      paths.add(key);
      expandObjectKeys(value, paths);
    } else {
      paths.add(key);
    }
  }
}

/**
 * Collects flat rule paths by walking fieldValues only (see TEMPLATE_FIELD_RULES_PLAN.md).
 */
export function collectRulePathsFromFieldValues(fieldValues: Record<string, unknown>): string[] {
  const paths = new Set<string>();

  for (const [key, value] of Object.entries(fieldValues)) {
    if (isArrayOfObjects(value)) {
      expandObjectKeys(value[0], paths);
    } else if (isPlainObject(value)) {
      paths.add(key);
      for (const childKey of Object.keys(value)) {
        paths.add(childKey);
      }
    } else {
      paths.add(key);
    }
  }

  return [...paths];
}

export function generateDefaultRule(): TemplateFieldRule {
  return {
    enable: true,
    orgedit: true,
    add: true,
    defaultedit: true,
    delete: true,
    metadataMode: TEMPLATE_RULE_METADATA_MODE_FIXED,
    min: 1,
    max: 1,
  };
}

export function buildRulesFromFieldValues(fieldValues: Record<string, unknown>): TemplateRulesMap {
  const rules: TemplateRulesMap = {};
  for (const path of collectRulePathsFromFieldValues(fieldValues)) {
    rules[path] = generateDefaultRule();
  }
  return rules;
}

function normalizeRuleValue(value: Record<string, unknown>): TemplateFieldRule {
  const base = generateDefaultRule();
  const next: TemplateFieldRule = { ...base };

  for (const key of TEMPLATE_FIELD_RULE_BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') {
      next[key] = value[key];
    }
  }

  if (typeof value.metadataMode === 'string' && value.metadataMode.trim()) {
    next.metadataMode = value.metadataMode.trim() as TemplateRuleMetadataMode;
  }

  if (typeof value.min === 'number' && Number.isFinite(value.min)) {
    next.min = value.min;
  }

  if (typeof value.max === 'number' && Number.isFinite(value.max)) {
    next.max = value.max;
  }

  return next;
}

export function mergeRulesAdditive(
  existing: Record<string, unknown> | undefined,
  generated: TemplateRulesMap,
): TemplateRulesMap {
  const merged: TemplateRulesMap = {};

  if (existing && isPlainObject(existing)) {
    for (const [key, value] of Object.entries(existing)) {
      if (isPlainObject(value)) {
        merged[key] = normalizeRuleValue(value);
      }
    }
  }

  for (const [path, rule] of Object.entries(generated)) {
    if (merged[path] === undefined) {
      merged[path] = rule;
    }
  }

  return merged;
}

export function resolveFieldValuesForRules(
  document: Record<string, unknown>,
  body?: Record<string, unknown>,
): Record<string, unknown> {
  const fv: Record<string, unknown> = isPlainObject(document.fieldValues)
    ? { ...document.fieldValues }
    : {};

  if (!fv.TEMPLATE_NAME) {
    const templateName =
      (typeof body?.TEMPLATE_NAME === 'string' && body.TEMPLATE_NAME.trim()) ||
      (typeof body?.templateName === 'string' && body.templateName.trim()) ||
      (typeof fv.templateName === 'string' && fv.templateName.trim());
    if (templateName) {
      fv.TEMPLATE_NAME = templateName;
    }
  }

  return fv;
}

function normalizeStoredRules(rules: Record<string, unknown>): TemplateRulesMap {
  const out: TemplateRulesMap = {};
  for (const [key, value] of Object.entries(rules)) {
    if (isPlainObject(value)) {
      out[key] = normalizeRuleValue(value);
    }
  }
  return out;
}

/** Master/org VERSION row: use stored rules or generate from fieldValues. */
export function resolveOrgRulesFromMaster(masterVersion: {
  rules?: unknown;
  fieldValues?: unknown;
}): TemplateRulesMap {
  if (isPlainObject(masterVersion.rules) && Object.keys(masterVersion.rules).length > 0) {
    return normalizeStoredRules(masterVersion.rules);
  }

  const fieldValues = isPlainObject(masterVersion.fieldValues) ? masterVersion.fieldValues : {};
  return buildRulesFromFieldValues(fieldValues);
}

export function asTemplateRulesMap(rules: unknown): TemplateRulesMap {
  if (!isPlainObject(rules)) {
    return {};
  }
  return normalizeStoredRules(rules);
}

export class OrgRulesValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'OrgRulesValidationError';
  }
}

function assertRuleCardinality(rule: TemplateFieldRule, fieldPath: string): void {
  if (!Number.isInteger(rule.min) || rule.min < 0) {
    throw new OrgRulesValidationError(`Rule min for field path ${fieldPath} must be a non-negative integer`);
  }
  if (!Number.isInteger(rule.max) || rule.max < 0) {
    throw new OrgRulesValidationError(`Rule max for field path ${fieldPath} must be a non-negative integer`);
  }
  if (rule.min > rule.max) {
    throw new OrgRulesValidationError(
      `Rule min cannot exceed max for field path ${fieldPath}`,
    );
  }
}

/** Per-field shallow merge for org rules PUT; throws OrgRulesValidationError on invalid paths/keys. */
export function mergeOrgRulesPartial(
  existing: TemplateRulesMap,
  patch: Record<string, PartialTemplateFieldRule>,
): TemplateRulesMap {
  const merged: TemplateRulesMap = { ...existing };

  for (const [fieldPath, partialRule] of Object.entries(patch)) {
    if (merged[fieldPath] === undefined) {
      throw new OrgRulesValidationError(`Unknown rule field path: ${fieldPath}`);
    }
    if (!isPlainObject(partialRule)) {
      throw new OrgRulesValidationError(`Invalid rule object for field path: ${fieldPath}`);
    }

    const nextRule: TemplateFieldRule = { ...merged[fieldPath] };
    for (const [key, value] of Object.entries(partialRule)) {
      if (!TEMPLATE_FIELD_RULE_PATCH_KEYS.includes(key as TemplateFieldRulePatchKey)) {
        throw new OrgRulesValidationError(`Unknown rule key "${key}" for field path: ${fieldPath}`);
      }

      if ((TEMPLATE_FIELD_RULE_BOOLEAN_KEYS as readonly string[]).includes(key)) {
        if (typeof value !== 'boolean') {
          throw new OrgRulesValidationError(
            `Rule key "${key}" for field path ${fieldPath} must be a boolean`,
          );
        }
        nextRule[key as TemplateFieldRuleBooleanKey] = value;
        continue;
      }

      if (key === 'metadataMode') {
        if (typeof value !== 'string' || !value.trim()) {
          throw new OrgRulesValidationError(
            `Rule key metadataMode for field path ${fieldPath} must be a non-empty string`,
          );
        }
        nextRule.metadataMode = value.trim() as TemplateRuleMetadataMode;
        continue;
      }

      if (key === 'min' || key === 'max') {
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
          throw new OrgRulesValidationError(
            `Rule key "${key}" for field path ${fieldPath} must be a non-negative integer`,
          );
        }
        nextRule[key] = value;
      }
    }

    assertRuleCardinality(nextRule, fieldPath);
    merged[fieldPath] = nextRule;
  }

  return merged;
}
