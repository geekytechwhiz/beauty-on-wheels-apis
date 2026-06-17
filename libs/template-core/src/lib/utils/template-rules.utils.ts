import {
  isLinkedTemplateFieldKey,
  LINKED_TEMPLATE_FIELD_KEY_PREFIX,
  LINKED_TEMPLATE_MAX_LINKS,
  LINKED_TEMPLATE_NESTED_ARRAY_MAX,
  TEMPLATE_TYPE_CARE_PLAN,
} from '../constants/template.constants';

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

/** Rule leaf or container with nested child field rules (CARE_PLAN LINKED_* only). */
export type TemplateFieldRuleNode = TemplateFieldRule & {
  [nestedField: string]: TemplateFieldRuleNode | TemplateRuleMetadataMode | number | boolean | undefined;
};

export type TemplateRulesMap = Record<string, TemplateFieldRuleNode>;

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

export type TemplateRulesPatch = Record<string, PartialTemplateFieldRule | Record<string, unknown>>;

export type BuildRulesFromFieldValuesOptions = {
  templateType?: string;
};

function collectLinkedTemplateFieldKeys(fieldValues: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(fieldValues).filter(isLinkedTemplateFieldKey));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isArrayOfObjects(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && isPlainObject(value[0]);
}

function isRuleScalarKey(key: string): key is TemplateFieldRulePatchKey {
  return (TEMPLATE_FIELD_RULE_PATCH_KEYS as readonly string[]).includes(key);
}

function normalizeTemplateType(templateType?: string): string | undefined {
  const normalized = templateType?.trim().toUpperCase();
  return normalized || undefined;
}

function isCarePlanTemplateType(templateType?: string): boolean {
  return normalizeTemplateType(templateType) === TEMPLATE_TYPE_CARE_PLAN;
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
 * Skips CARE_PLAN linking keys when provided — those use nested rules instead.
 */
export function collectRulePathsFromFieldValues(
  fieldValues: Record<string, unknown>,
  skipKeys: ReadonlySet<string> = new Set(),
): string[] {
  const paths = new Set<string>();

  for (const [key, value] of Object.entries(fieldValues)) {
    if (skipKeys.has(key)) continue;

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

function generateLinkedTemplateContainerRule(): TemplateFieldRuleNode {
  return {
    ...generateDefaultRule(),
    min: 0,
    max: LINKED_TEMPLATE_MAX_LINKS,
  };
}

/** Nested child rules mirroring one linked-template array item (CARE_PLAN). */
export function buildNestedRulesFromLinkedItem(
  item: Record<string, unknown>,
): Record<string, TemplateFieldRuleNode> {
  const nested: Record<string, TemplateFieldRuleNode> = {};

  for (const [key, value] of Object.entries(item)) {
    if (isArrayOfObjects(value)) {
      nested[key] = {
        ...generateDefaultRule(),
        min: 0,
        max: LINKED_TEMPLATE_NESTED_ARRAY_MAX,
        ...buildNestedRulesFromLinkedItem(value[0]),
      };
    } else if (isPlainObject(value)) {
      nested[key] = {
        ...generateDefaultRule(),
        ...buildNestedRulesFromLinkedItem(value),
      };
    } else {
      nested[key] = generateDefaultRule();
    }
  }

  return nested;
}

function buildCarePlanLinkedTemplateRules(
  fieldValues: Record<string, unknown>,
): TemplateRulesMap {
  const rules: TemplateRulesMap = {};

  for (const linkingKey of Object.keys(fieldValues)) {
    if (!isLinkedTemplateFieldKey(linkingKey)) continue;

    const value = fieldValues[linkingKey];
    const container = generateLinkedTemplateContainerRule();

    if (isArrayOfObjects(value)) {
      rules[linkingKey] = {
        ...container,
        ...buildNestedRulesFromLinkedItem(value[0]),
      };
    } else {
      rules[linkingKey] = container;
    }
  }

  return rules;
}

export function buildRulesFromFieldValues(
  fieldValues: Record<string, unknown>,
  options?: BuildRulesFromFieldValuesOptions,
): TemplateRulesMap {
  const rules: TemplateRulesMap = {};
  const carePlan = isCarePlanTemplateType(options?.templateType);
  const skipKeys = carePlan ? collectLinkedTemplateFieldKeys(fieldValues) : new Set<string>();

  if (carePlan) {
    Object.assign(rules, buildCarePlanLinkedTemplateRules(fieldValues));
  }

  for (const path of collectRulePathsFromFieldValues(fieldValues, skipKeys)) {
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

function normalizeRuleNode(value: Record<string, unknown>): TemplateFieldRuleNode {
  const node: TemplateFieldRuleNode = { ...normalizeRuleValue(value) };

  for (const [key, child] of Object.entries(value)) {
    if (!isRuleScalarKey(key) && isPlainObject(child)) {
      node[key] = normalizeRuleNode(child);
    }
  }

  return node;
}

function mergeRuleNodesAdditive(
  existing: TemplateFieldRuleNode,
  generated: TemplateFieldRuleNode,
): TemplateFieldRuleNode {
  const merged: TemplateFieldRuleNode = { ...existing };

  for (const [key, value] of Object.entries(generated)) {
    if (isRuleScalarKey(key)) continue;

    if (!isPlainObject(value)) continue;

    const currentChild = merged[key];
    if (currentChild === undefined) {
      merged[key] = normalizeRuleNode(value);
      continue;
    }

    if (isPlainObject(currentChild)) {
      merged[key] = mergeRuleNodesAdditive(
        currentChild as TemplateFieldRuleNode,
        value as TemplateFieldRuleNode,
      );
    }
  }

  return merged;
}

export function mergeRulesAdditive(
  existing: Record<string, unknown> | undefined,
  generated: TemplateRulesMap,
): TemplateRulesMap {
  const merged: TemplateRulesMap = {};

  if (existing && isPlainObject(existing)) {
    for (const [key, value] of Object.entries(existing)) {
      if (isPlainObject(value)) {
        merged[key] = normalizeRuleNode(value);
      }
    }
  }

  for (const [path, rule] of Object.entries(generated)) {
    if (merged[path] === undefined) {
      merged[path] = rule;
      continue;
    }

    merged[path] = mergeRuleNodesAdditive(merged[path], rule);
  }

  return merged;
}

/**
 * After fieldValues change on master/org VERSION rows: additive merge for flat keys;
 * full replace for each CARE_PLAN {@link LINKED_TEMPLATE_FIELD_KEY_PREFIX} rule subtree.
 */
export function mergeRulesAfterFieldValuesChange(
  existing: Record<string, unknown> | undefined,
  generated: TemplateRulesMap,
  options?: BuildRulesFromFieldValuesOptions,
): TemplateRulesMap {
  const merged = mergeRulesAdditive(existing, generated);

  if (!isCarePlanTemplateType(options?.templateType)) {
    return merged;
  }

  for (const [key, rule] of Object.entries(generated)) {
    if (isLinkedTemplateFieldKey(key)) {
      merged[key] = rule;
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
      out[key] = normalizeRuleNode(value);
    }
  }
  return out;
}

function resolveTemplateTypeFromVersion(masterVersion: {
  meta?: { templateType?: string };
  fieldValues?: unknown;
}): string | undefined {
  if (typeof masterVersion.meta?.templateType === 'string' && masterVersion.meta.templateType.trim()) {
    return masterVersion.meta.templateType;
  }
  return undefined;
}

/** Master/org VERSION row: use stored rules or generate from fieldValues. */
export function resolveOrgRulesFromMaster(masterVersion: {
  rules?: unknown;
  fieldValues?: unknown;
  meta?: { templateType?: string };
}): TemplateRulesMap {
  if (isPlainObject(masterVersion.rules) && Object.keys(masterVersion.rules).length > 0) {
    return normalizeStoredRules(masterVersion.rules);
  }

  const fieldValues = isPlainObject(masterVersion.fieldValues) ? masterVersion.fieldValues : {};
  return buildRulesFromFieldValues(fieldValues, {
    templateType: resolveTemplateTypeFromVersion(masterVersion),
  });
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

function applyScalarRulePatch(
  target: TemplateFieldRuleNode,
  key: string,
  value: unknown,
  fieldPath: string,
): void {
  if ((TEMPLATE_FIELD_RULE_BOOLEAN_KEYS as readonly string[]).includes(key)) {
    if (typeof value !== 'boolean') {
      throw new OrgRulesValidationError(
        `Rule key "${key}" for field path ${fieldPath} must be a boolean`,
      );
    }
    target[key as TemplateFieldRuleBooleanKey] = value;
    return;
  }

  if (key === 'metadataMode') {
    if (typeof value !== 'string' || !value.trim()) {
      throw new OrgRulesValidationError(
        `Rule key metadataMode for field path ${fieldPath} must be a non-empty string`,
      );
    }
    target.metadataMode = value.trim() as TemplateRuleMetadataMode;
    return;
  }

  if (key === 'min' || key === 'max') {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new OrgRulesValidationError(
        `Rule key "${key}" for field path ${fieldPath} must be a non-negative integer`,
      );
    }
    target[key] = value;
  }
}

function mergeRuleNodePartial(
  existing: TemplateFieldRuleNode,
  patch: Record<string, unknown>,
  fieldPath: string,
): TemplateFieldRuleNode {
  const next: TemplateFieldRuleNode = { ...existing };

  for (const [key, value] of Object.entries(patch)) {
    if (isRuleScalarKey(key)) {
      applyScalarRulePatch(next, key, value, fieldPath);
      continue;
    }

    if (!isPlainObject(value)) {
      throw new OrgRulesValidationError(`Invalid rule object for field path: ${fieldPath}.${key}`);
    }

    const childExisting = existing[key];
    if (!isPlainObject(childExisting)) {
      throw new OrgRulesValidationError(`Unknown nested rule field path: ${fieldPath}.${key}`);
    }

    next[key] = mergeRuleNodePartial(
      childExisting as TemplateFieldRuleNode,
      value,
      `${fieldPath}.${key}`,
    );
  }

  assertRuleCardinality(next, fieldPath);
  return next;
}

/** Per-field merge for org rules PUT; supports nested patches under CARE_PLAN LINKED_* keys. */
export function mergeOrgRulesPartial(
  existing: TemplateRulesMap,
  patch: TemplateRulesPatch,
): TemplateRulesMap {
  const merged: TemplateRulesMap = { ...existing };

  for (const [fieldPath, partialRule] of Object.entries(patch)) {
    if (merged[fieldPath] === undefined) {
      throw new OrgRulesValidationError(`Unknown rule field path: ${fieldPath}`);
    }
    if (!isPlainObject(partialRule)) {
      throw new OrgRulesValidationError(`Invalid rule object for field path: ${fieldPath}`);
    }

    merged[fieldPath] = mergeRuleNodePartial(merged[fieldPath], partialRule, fieldPath);
  }

  return merged;
}
