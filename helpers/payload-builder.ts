import type {
  MetadataTypeCreatePayload,
  MetadataTypeSeedDefinition,
  MetadataValueCreatePayload,
  RichValueSeed,
  SimpleValueSeed,
} from './interfaces';

const TYPE_CODE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const VALUE_CODE_PATTERN = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;

export function buildMetadataTypePayload(def: MetadataTypeSeedDefinition): MetadataTypeCreatePayload {
  const payload: MetadataTypeCreatePayload = {
    metadataTypeCode: def.metadataTypeCode,
    displayName: def.displayName,
    valueDataType: def.valueDataType,
    multiSelectAllowed: def.multiSelectAllowed,
    status: def.status ?? 'ACTIVE',
  };

  if (def.description) {
    payload.description = def.description;
  }
  if (def.applicableModules !== undefined) {
    payload.applicableModules = def.applicableModules;
  }
  if (def.valueApplicabilityConfig) {
    payload.valueApplicabilityConfig = def.valueApplicabilityConfig;
  }
  if (def.attributeSchema) {
    payload.attributeSchema = def.attributeSchema;
  }
  if (def.relation) {
    payload.supportsRelations = true;
    payload.relationType = def.relation.relationType;
    payload.targetMetadataTypeCode = def.relation.targetMetadataTypeCode;
    payload.relationFieldLabel = def.relation.relationFieldLabel;
    payload.selectionMode = def.relation.selectionMode;
    payload.relationRequired = def.relation.relationRequired;
  } else {
    payload.supportsRelations = false;
  }

  return payload;
}

export function buildMetadataValuePayload(
  metadataTypeCode: string,
  seed: SimpleValueSeed | RichValueSeed,
): MetadataValueCreatePayload {
  const rich = seed as RichValueSeed;
  const payload: MetadataValueCreatePayload = {
    metadataTypeCode,
    metadataValueCode: seed.metadataValueCode,
    label: seed.label,
    status: 'ACTIVE',
    isGlobal: seed.isGlobal ?? false,
  };

  if (seed.description) {
    payload.description = seed.description;
  }
  if (seed.sortOrder !== undefined) {
    payload.sortOrder = seed.sortOrder;
  }
  if (seed.applicableModules?.length) {
    payload.applicableModules = seed.applicableModules.map((t) => t.toUpperCase());
  }
  if (seed.applicableCategories?.length) {
    payload.applicableCategories = seed.applicableCategories.map((t) => t.toUpperCase());
  }
  if (seed.applicableConditions?.length) {
    payload.applicableConditions = seed.applicableConditions.map((t) => t.toUpperCase());
  }
  if (seed.applicableCountries?.length) {
    payload.applicableCountries = seed.applicableCountries.map((t) => t.toUpperCase());
  }
  if (seed.applicableLanguages?.length) {
    payload.applicableLanguages = seed.applicableLanguages.map((t) => t.toUpperCase());
  }
  if (rich.valueAttributes) {
    payload.valueAttributes = rich.valueAttributes;
  }
  if (rich.relationships?.length) {
    payload.relationships = rich.relationships;
  }

  return payload;
}

export function validateTypePayload(payload: MetadataTypeCreatePayload): string[] {
  const errors: string[] = [];
  if (!TYPE_CODE_PATTERN.test(payload.metadataTypeCode)) {
    errors.push(`Invalid metadataTypeCode: ${payload.metadataTypeCode}`);
  }
  if (!payload.displayName?.trim()) {
    errors.push('displayName is required');
  }
  if (payload.metadataTypeCode === 'ApplicableModule' && payload.applicableModules?.length) {
    errors.push('ApplicableModule type must not define applicableModules (circular dependency)');
  }
  return errors;
}

export function validateValuePayload(payload: MetadataValueCreatePayload): string[] {
  const errors: string[] = [];
  if (!TYPE_CODE_PATTERN.test(payload.metadataTypeCode)) {
    errors.push(`Invalid metadataTypeCode: ${payload.metadataTypeCode}`);
  }
  if (!VALUE_CODE_PATTERN.test(payload.metadataValueCode)) {
    errors.push(`Invalid metadataValueCode: ${payload.metadataValueCode}`);
  }
  if (!payload.label?.trim()) {
    errors.push('label is required');
  }
  if (
    payload.metadataTypeCode === 'ApplicableModule' &&
    (payload.applicableModules?.length ||
      payload.applicableCategories?.length ||
      payload.applicableConditions?.length)
  ) {
    errors.push('ApplicableModule values must not set applicability constraints');
  }
  return errors;
}
