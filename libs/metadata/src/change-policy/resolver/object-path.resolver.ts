import { metadataTypeUsesSeparateSchemaItem } from '../../constants';
import type { ApplicabilityChangeKind } from '../types/policy-group.codes';

const VALUE_APPLICABILITY_PATHS: Record<string, string> = {
  applicableModules: 'MetadataValue.ApplicableModules',
  applicableCategories: 'MetadataValue.ApplicableCategories',
  applicableConditions: 'MetadataValue.ApplicableConditions',
  applicableCountries: 'MetadataValue.ApplicableCountries',
  applicableLanguages: 'MetadataValue.ApplicableLanguages',
};

const VALUE_SCALAR_PATHS: Record<string, string> = {
  label: 'MetadataValue.Label',
  description: 'MetadataValue.Description',
  sortOrder: 'MetadataValue.SortOrder',
  status: 'MetadataValue.Status',
  metadataValueCode: 'MetadataValue.MetadataValueCode',
  valueCode: 'MetadataValue.MetadataValueCode',
};

const TYPE_SCALAR_PATHS: Record<string, string> = {
  metadataTypeCode: 'MetadataType.MetadataTypeCode',
  displayName: 'MetadataType.DisplayName',
  description: 'MetadataType.Description',
  valueDataType: 'MetadataType.ValueDataType',
  multiSelectAllowed: 'MetadataType.MultiSelectAllowed',
  applicableModules: 'MetadataType.ApplicableModules',
  status: 'MetadataType.Status',
  attributeSchema: 'MetadataType.AttributeSchema',
  schemaVersion: 'MetadataType.AttributeSchema',
};

const TYPE_RELATION_KEYS = new Set([
  'supportsRelations',
  'relationFieldLabel',
  'targetMetadataTypeCode',
  'selectionMode',
  'relationRequired',
  'relationType',
]);

/** Maps a value attribute key to the governed catalog object path. */
export function resolveValueAttributeObjectPath(metadataTypeCode: string, attributeKey: string): string {
  if (metadataTypeCode === 'MetricCode') {
    return `MetricCode.ValueAttributes.${attributeKey}`;
  }
  if (metadataTypeCode === 'QuestionCode') {
    return `QuestionCode.ValueAttributes.${attributeKey}`;
  }
  return 'MetadataValue.ValueAttributes';
}

/** Maps a flat delta key from value audit diff to catalog object path. */
export function resolveValueDeltaKeyToObjectPath(
  metadataTypeCode: string,
  deltaKey: string,
): string | null {
  if (deltaKey in VALUE_SCALAR_PATHS) {
    return VALUE_SCALAR_PATHS[deltaKey];
  }
  if (deltaKey in VALUE_APPLICABILITY_PATHS) {
    return VALUE_APPLICABILITY_PATHS[deltaKey];
  }
  if (deltaKey === 'valueAttributes') {
    return metadataTypeUsesSeparateSchemaItem(metadataTypeCode)
      ? `${metadataTypeCode}.ValueAttributes`
      : 'MetadataValue.ValueAttributes';
  }
  if (deltaKey === 'isGlobal') {
    return null;
  }
  return null;
}

/** Maps a flat delta key from type audit diff to catalog object path. */
export function resolveTypeDeltaKeyToObjectPath(deltaKey: string): string | null {
  if (TYPE_RELATION_KEYS.has(deltaKey)) {
    return 'MetadataType.RelationConfig';
  }
  if (deltaKey in TYPE_SCALAR_PATHS) {
    return TYPE_SCALAR_PATHS[deltaKey];
  }
  return null;
}

export function resolveEntityAddObjectPath(entityType: 'type' | 'value'): string {
  return entityType === 'type' ? 'MetadataType' : 'MetadataValue';
}

export function resolveValueAttributesContainerPath(metadataTypeCode: string): string {
  if (metadataTypeCode === 'MetricCode') {
    return 'MetricCode.ValueAttributes';
  }
  if (metadataTypeCode === 'QuestionCode') {
    return 'QuestionCode.ValueAttributes';
  }
  return 'MetadataValue.ValueAttributes';
}

/** Classifies token-list mutations for applicability / supportedSourceTypes rules. */
export function classifyListChangeKind(before: unknown, after: unknown): ApplicabilityChangeKind {
  const b = normalizeTokenList(before);
  const a = normalizeTokenList(after);
  const bSet = new Set(b);
  const aSet = new Set(a);
  let removed = false;
  let added = false;
  for (const token of bSet) {
    if (!aSet.has(token)) {
      removed = true;
    }
  }
  for (const token of aSet) {
    if (!bSet.has(token)) {
      added = true;
    }
  }
  if (removed) {
    return 'Restrict';
  }
  if (added) {
    return 'Expand';
  }
  return 'Any';
}

function normalizeTokenList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((v) => String(v).trim()).filter(Boolean);
}

export { VALUE_APPLICABILITY_PATHS, TYPE_SCALAR_PATHS, VALUE_SCALAR_PATHS };
