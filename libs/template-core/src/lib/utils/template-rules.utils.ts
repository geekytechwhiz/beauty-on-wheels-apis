import {
  isLinkedTemplateFieldKey,
  LINKED_TEMPLATE_MAX_LINKS,
  LINKED_TEMPLATE_NESTED_ARRAY_MAX,
  TEMPLATE_TYPE_CARE_PLAN,
} from '../constants/template.constants';
import {
  isLabelValueObject,
  isLabelValueOnlyArray,
  normalizeLinkValueForRules,
  resolveTemplateDisplayName,
} from './field-values-profile.utils';

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

/** Leaf rule or container with child field rules in a nested `rules` map (CARE_PLAN LINKED_*). */
export type TemplateFieldRuleNode = TemplateFieldRule & {
  rules?: Record<string, TemplateFieldRuleNode>;
};

export const LINKED_RULES_CHILD_MAP_KEY = 'rules' as const;

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

export type PartialTemplateFieldRule = Partial<TemplateFieldRule> & {
  rules?: Record<string, PartialTemplateFieldRule>;
};

export type TemplateRulesPatch = Record<string, PartialTemplateFieldRule>;

export type BuildRulesFromFieldValuesOptions = {
  templateType?: string;
};

export type MergeRulesAfterFieldValuesChangeOptions = BuildRulesFromFieldValuesOptions & {
  fieldValues?: Record<string, unknown>;
  previousFieldValues?: Record<string, unknown>;
};

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
 * Skips CARE_PLAN linking keys when provided — inner keys live under rules[LINKED_*].rules.
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

function generateLinkedTemplateContainerRule(): TemplateFieldRule {
  return {
    ...generateDefaultRule(),
    min: 0,
    max: LINKED_TEMPLATE_MAX_LINKS,
  };
}

function generateLinkedArrayContainerRule(): TemplateFieldRule {
  return {
    ...generateDefaultRule(),
    min: 0,
    max: LINKED_TEMPLATE_NESTED_ARRAY_MAX,
  };
}

function collectPathsFromLinkedItem(item: Record<string, unknown>, paths: Set<string>): void {
  for (const [key, value] of Object.entries(item)) {
    if (isArrayOfObjects(value)) {
      paths.add(key);
      collectPathsFromLinkedItem(value[0], paths);
    } else if (isPlainObject(value)) {
      paths.add(key);
      collectPathsFromLinkedItem(value, paths);
    } else {
      paths.add(key);
    }
  }
}

/** Inner field paths from linked-template items (for stale flat-key cleanup at rules root). */
export function collectLinkedItemInnerRulePaths(fieldValues: Record<string, unknown>): Set<string> {
  const paths = new Set<string>();

  for (const linkingKey of Object.keys(fieldValues)) {
    if (!isLinkedTemplateFieldKey(linkingKey)) continue;
    const item = normalizeLinkValueForRules(fieldValues[linkingKey]);
    if (item) {
      collectPathsFromLinkedItem(item, paths);
    }
  }

  return paths;
}

/** Builds the nested `rules` map for one linked-template item (CARE_PLAN). */
export function buildLinkedItemRulesMap(
  item: Record<string, unknown>,
): Record<string, TemplateFieldRuleNode> {
  const rulesMap: Record<string, TemplateFieldRuleNode> = {};

  for (const [key, value] of Object.entries(item)) {
    if (isLinkedTemplateFieldKey(key)) {
      rulesMap[key] = buildLinkedTemplateRuleNode(value);
      continue;
    }

    rulesMap[key] = buildCarePlanFieldRuleNode(value);
  }

  return rulesMap;
}

function buildLinkedTemplateRuleNode(value: unknown): TemplateFieldRuleNode {
  const container = generateLinkedTemplateContainerRule();
  const item = normalizeLinkValueForRules(value);
  if (!item) {
    return container;
  }
  return {
    ...container,
    rules: buildLinkedItemRulesMap(item),
  };
}

function buildCarePlanFieldRuleNode(value: unknown): TemplateFieldRuleNode {
  if (isLabelValueObject(value)) {
    return generateDefaultRule();
  }

  if (Array.isArray(value)) {
    if (value.length === 0 || isLabelValueOnlyArray(value)) {
      return generateLinkedArrayContainerRule();
    }
    if (isArrayOfObjects(value)) {
      return {
        ...generateLinkedArrayContainerRule(),
        rules: buildLinkedItemRulesMap(value[0]),
      };
    }
    return generateLinkedArrayContainerRule();
  }

  if (isPlainObject(value)) {
    return {
      ...generateDefaultRule(),
      rules: buildLinkedItemRulesMap(value),
    };
  }

  return generateDefaultRule();
}

const DERIVED_CATALOG_FIELD_KEYS = new Set(['categoryCode', 'conditionCode']);

function shouldSkipDenormalizedCatalogKey(
  key: string,
  fieldValues: Record<string, unknown>,
): boolean {
  if (key === 'categoryCode') {
    return fieldValues.Category !== undefined || fieldValues.CATEGORY !== undefined;
  }
  if (key === 'conditionCode') {
    return fieldValues.Condition !== undefined || fieldValues.CONDITION !== undefined;
  }
  return false;
}

function buildCarePlanRules(fieldValues: Record<string, unknown>): TemplateRulesMap {
  const rules: TemplateRulesMap = {};

  for (const [key, value] of Object.entries(fieldValues)) {
    if (DERIVED_CATALOG_FIELD_KEYS.has(key) && shouldSkipDenormalizedCatalogKey(key, fieldValues)) {
      continue;
    }

    if (isLinkedTemplateFieldKey(key)) {
      rules[key] = buildLinkedTemplateRuleNode(value);
      continue;
    }

    rules[key] = buildCarePlanFieldRuleNode(value);
  }

  return rules;
}

export function buildRulesFromFieldValues(
  fieldValues: Record<string, unknown>,
  options?: BuildRulesFromFieldValuesOptions,
): TemplateRulesMap {
  if (isCarePlanTemplateType(options?.templateType)) {
    return buildCarePlanRules(fieldValues);
  }

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

function normalizeRuleNode(value: Record<string, unknown>): TemplateFieldRuleNode {
  const node: TemplateFieldRuleNode = { ...normalizeRuleValue(value) };

  if (isPlainObject(value[LINKED_RULES_CHILD_MAP_KEY])) {
    const childRules: Record<string, TemplateFieldRuleNode> = {};
    for (const [key, child] of Object.entries(value[LINKED_RULES_CHILD_MAP_KEY])) {
      if (isPlainObject(child)) {
        childRules[key] = normalizeRuleNode(child);
      }
    }
    if (Object.keys(childRules).length > 0) {
      node.rules = childRules;
    }
  }

  return node;
}

function mergeLinkedRulesMapAdditive(
  existing: Record<string, TemplateFieldRuleNode> | undefined,
  generated: Record<string, TemplateFieldRuleNode>,
): Record<string, TemplateFieldRuleNode> {
  const merged: Record<string, TemplateFieldRuleNode> = { ...(existing ?? {}) };

  for (const [key, generatedChild] of Object.entries(generated)) {
    const currentChild = merged[key];
    if (currentChild === undefined) {
      merged[key] = generatedChild;
      continue;
    }
    merged[key] = mergeRuleNodesAdditive(currentChild, generatedChild);
  }

  return merged;
}

function mergeRuleNodesAdditive(
  existing: TemplateFieldRuleNode,
  generated: TemplateFieldRuleNode,
): TemplateFieldRuleNode {
  const merged: TemplateFieldRuleNode = { ...existing };

  for (const key of TEMPLATE_FIELD_RULE_PATCH_KEYS) {
    if (generated[key] !== undefined) {
      merged[key] = generated[key] as never;
    }
  }

  if (generated.rules) {
    merged.rules = mergeLinkedRulesMapAdditive(existing.rules, generated.rules);
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
 * full replace for each CARE_PLAN LINKED_* container and its nested rules subtree.
 */
export function mergeRulesAfterFieldValuesChange(
  existing: Record<string, unknown> | undefined,
  generated: TemplateRulesMap,
  options?: MergeRulesAfterFieldValuesChangeOptions,
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

  const newLinkedPaths = options?.fieldValues
    ? collectLinkedItemInnerRulePaths(options.fieldValues)
    : new Set<string>();

  // Inner linked-item keys belong under rules[LINKED_*].rules — remove any flat copies at rules root.
  for (const path of newLinkedPaths) {
    if (!isLinkedTemplateFieldKey(path)) {
      delete merged[path];
    }
  }

  if (options?.previousFieldValues) {
    const oldLinkedPaths = collectLinkedItemInnerRulePaths(options.previousFieldValues);
    for (const path of oldLinkedPaths) {
      if (!newLinkedPaths.has(path) && !isLinkedTemplateFieldKey(path)) {
        delete merged[path];
      }
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

  if (!fv.TEMPLATE_NAME && !fv.TemplateName) {
    const templateName = resolveTemplateDisplayName(body, fv);
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
  target: TemplateFieldRule,
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

function mergeRulePartial(
  existing: TemplateFieldRule,
  patch: Record<string, unknown>,
  fieldPath: string,
): TemplateFieldRule {
  const next: TemplateFieldRule = { ...existing };

  for (const [key, value] of Object.entries(patch)) {
    if (!isRuleScalarKey(key)) {
      throw new OrgRulesValidationError(`Unknown rule field path: ${fieldPath}.${key}`);
    }
    applyScalarRulePatch(next, key, value, fieldPath);
  }

  assertRuleCardinality(next, fieldPath);
  return next;
}

function mergeLinkedRulesMapPartial(
  existing: Record<string, TemplateFieldRuleNode>,
  patch: Record<string, unknown>,
  parentPath: string,
): Record<string, TemplateFieldRuleNode> {
  const merged: Record<string, TemplateFieldRuleNode> = { ...existing };

  for (const [key, partialRule] of Object.entries(patch)) {
    const fieldPath = `${parentPath}.${LINKED_RULES_CHILD_MAP_KEY}.${key}`;
    if (merged[key] === undefined) {
      throw new OrgRulesValidationError(`Unknown rule field path: ${fieldPath}`);
    }
    if (!isPlainObject(partialRule)) {
      throw new OrgRulesValidationError(`Invalid rule object for field path: ${fieldPath}`);
    }
    merged[key] = mergeRuleNodePartial(merged[key], partialRule, fieldPath);
  }

  return merged;
}

function mergeRuleNodePartial(
  existing: TemplateFieldRuleNode,
  patch: Record<string, unknown>,
  fieldPath: string,
): TemplateFieldRuleNode {
  let next: TemplateFieldRuleNode = { ...existing };
  const scalarPatch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (key === LINKED_RULES_CHILD_MAP_KEY) {
      if (!isPlainObject(value)) {
        throw new OrgRulesValidationError(`Invalid rule object for field path: ${fieldPath}.rules`);
      }
      const existingRules = existing.rules ?? {};
      next.rules = mergeLinkedRulesMapPartial(existingRules, value, fieldPath);
      continue;
    }

    if (isRuleScalarKey(key)) {
      scalarPatch[key] = value;
      continue;
    }

    throw new OrgRulesValidationError(`Unknown rule field path: ${fieldPath}.${key}`);
  }

  if (Object.keys(scalarPatch).length > 0) {
    next = { ...next, ...mergeRulePartial(next, scalarPatch, fieldPath) };
  }

  return next;
}

/** Per-field merge for org rules PUT — supports nested `rules` under LINKED_* containers. */
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
