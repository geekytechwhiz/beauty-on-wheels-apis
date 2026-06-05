import {
  VALUE_DATA_TYPES,
  type Applicability,
  type MetadataTypeInput,
  type MetadataTypeRecord,
  type MetadataValueInput,
  type RelationSelectionMode,
  type Status,
  type ValueDataType,
  type ValueSearchFilter,
} from '../models/types';
import type { RelationType } from '../models/relation-types';
import { RELATION_TYPES } from '../models/relation-types';
import { ValidationError } from '../domain/errors';
import { assertEnumTokenArray, assertMetadataTypeCode, assertMetadataValueCode } from './code-patterns';
import {
  resolveValueAttributeSchemaForValidation,
  validateAttributesAgainstSchema,
} from './attribute-schema.validator';
import { validateMetricCodeAttributes } from './metric-code.schema';
import { validateQuestionCodeAttributes } from './question-code.schema';
import {
  validateMetadataValueApplicabilityRules,
} from '../mappers/metadata-value-request';
import { assertStatusEnum, assertStatusFilterEnum } from './status';

const DISPLAY_NAME_MAX = 100;
const METADATA_VALUE_LABEL_MAX = 150;
const METADATA_VALUE_DESCRIPTION_MAX = 2000;

const RELATION_FIELD_LABEL_MAX = 150;

const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);
const SELECTION_MODES = new Set<string>(['SINGLE', 'MULTI']);

function assertRelationTypeEnum(raw: unknown, field = 'relationType'): RelationType {
  if (typeof raw !== 'string' || !RELATION_TYPE_SET.has(raw)) {
    throw new ValidationError('relationType must be a supported relation type', [
      { field, message: `Must be one of: ${RELATION_TYPES.join(', ')}` },
    ]);
  }
  return raw as RelationType;
}

/**
 * Validates relation configuration snapshot on metadata type create/update (sync rules).
 * Call after merge for updates so the full snapshot is validated.
 */
export function validateMetadataTypeRelationConfig(input: MetadataTypeInput): void {
  const supports =
    input.supportsRelations === undefined ? false : Boolean(input.supportsRelations);

  if (!supports) {
    const bad: { field: string; message: string }[] = [];
    if (input.relationFieldLabel != null && input.relationFieldLabel !== undefined) {
      bad.push({ field: 'relationFieldLabel', message: 'Must be null or omitted when supportsRelations is false' });
    }
    if (input.targetMetadataTypeCode != null && input.targetMetadataTypeCode !== undefined) {
      bad.push({
        field: 'targetMetadataTypeCode',
        message: 'Must be null or omitted when supportsRelations is false',
      });
    }
    if (input.selectionMode != null && input.selectionMode !== undefined) {
      bad.push({ field: 'selectionMode', message: 'Must be null or omitted when supportsRelations is false' });
    }
    if (input.relationRequired != null && input.relationRequired !== undefined) {
      bad.push({ field: 'relationRequired', message: 'Must be null or omitted when supportsRelations is false' });
    }
    if (input.relationType != null && input.relationType !== undefined) {
      bad.push({ field: 'relationType', message: 'Must be null or omitted when supportsRelations is false' });
    }
    if (bad.length) {
      throw new ValidationError('Relation fields must be cleared when supportsRelations is false', bad);
    }
    return;
  }

  if (!input.relationFieldLabel || typeof input.relationFieldLabel !== 'string' || !input.relationFieldLabel.trim()) {
    throw new ValidationError('relationFieldLabel is required when supportsRelations is true', [
      { field: 'relationFieldLabel', message: 'Required' },
    ]);
  }
  if (input.relationFieldLabel.length > RELATION_FIELD_LABEL_MAX) {
    throw new ValidationError(`relationFieldLabel must be at most ${RELATION_FIELD_LABEL_MAX} characters`, [
      { field: 'relationFieldLabel', message: `Max ${RELATION_FIELD_LABEL_MAX} characters` },
    ]);
  }
  if (!input.targetMetadataTypeCode || typeof input.targetMetadataTypeCode !== 'string' || !input.targetMetadataTypeCode.trim()) {
    throw new ValidationError('targetMetadataTypeCode is required when supportsRelations is true', [
      { field: 'targetMetadataTypeCode', message: 'Required' },
    ]);
  }
  assertMetadataTypeCode(input.targetMetadataTypeCode, 'targetMetadataTypeCode');
  if (input.targetMetadataTypeCode === input.metadataTypeCode) {
    throw new ValidationError('targetMetadataTypeCode must differ from metadataTypeCode', [
      { field: 'targetMetadataTypeCode', message: 'Cannot reference the same type' },
    ]);
  }
  if (input.selectionMode == null || input.selectionMode === undefined) {
    throw new ValidationError('selectionMode is required when supportsRelations is true', [
      { field: 'selectionMode', message: 'Required' },
    ]);
  }
  if (!SELECTION_MODES.has(String(input.selectionMode))) {
    throw new ValidationError('selectionMode must be SINGLE or MULTI', [
      { field: 'selectionMode', message: 'Invalid' },
    ]);
  }
  const _selCheck: RelationSelectionMode =
    input.selectionMode === 'SINGLE' || input.selectionMode === 'MULTI' ? input.selectionMode : 'SINGLE';
  void _selCheck;
  if (input.relationRequired === undefined || input.relationRequired === null) {
    throw new ValidationError('relationRequired is required when supportsRelations is true', [
      { field: 'relationRequired', message: 'Required boolean' },
    ]);
  }
  if (typeof input.relationRequired !== 'boolean') {
    throw new ValidationError('relationRequired must be a boolean', [{ field: 'relationRequired', message: 'Invalid' }]);
  }
  if (input.relationType === undefined || input.relationType === null) {
    throw new ValidationError('relationType is required when supportsRelations is true', [
      { field: 'relationType', message: 'Required' },
    ]);
  }
  assertRelationTypeEnum(input.relationType);
}

export function validateMetadataTypeInput(input: MetadataTypeInput, isUpdate = false): void {
  assertMetadataTypeCode(input.metadataTypeCode);
  validateMetadataTypeRelationConfig(input);
  if (!isUpdate) {
    if (!input.displayName?.trim()) {
      throw new ValidationError('displayName is required on create', [{ field: 'displayName', message: 'Required' }]);
    }
    if (input.displayName.length > DISPLAY_NAME_MAX) {
      throw new ValidationError(`displayName must be at most ${DISPLAY_NAME_MAX} characters`, [
        { field: 'displayName', message: `Max ${DISPLAY_NAME_MAX} characters` },
      ]);
    }
    if (!input.valueDataType?.trim()) {
      throw new ValidationError('valueDataType is required on create', [{ field: 'valueDataType', message: 'Required' }]);
    }
    if (!VALUE_DATA_TYPES.includes(input.valueDataType as ValueDataType)) {
      throw new ValidationError('valueDataType must be Enum, Numeric, Boolean, or Text', [
        { field: 'valueDataType', message: 'Invalid enum' },
      ]);
    }
    if (input.multiSelectAllowed === undefined) {
      throw new ValidationError('multiSelectAllowed is required on create', [{ field: 'multiSelectAllowed', message: 'Required' }]);
    }
    if (input.applicableModules !== undefined && input.applicableModules.length > 0) {
      assertEnumTokenArray(input.applicableModules, 'applicableModules');
    }
    if (input.status === undefined || input.status === null || String(input.status).trim() === '') {
      throw new ValidationError('status is required on create', [{ field: 'status', message: 'Required' }]);
    }
    assertStatusEnum(input.status);
    return;
  }

  // Update path validates the final merged snapshot (after PATCH-style merge with the stored type).
  if (input.displayName === undefined || input.displayName === null) {
    throw new ValidationError('displayName is required on update', [{ field: 'displayName', message: 'Required' }]);
  }
  if (typeof input.displayName !== 'string' || !input.displayName.trim()) {
    throw new ValidationError('displayName cannot be empty', [{ field: 'displayName', message: 'Invalid' }]);
  }
  if (input.displayName.length > DISPLAY_NAME_MAX) {
    throw new ValidationError(`displayName must be at most ${DISPLAY_NAME_MAX} characters`, [
      { field: 'displayName', message: `Max ${DISPLAY_NAME_MAX} characters` },
    ]);
  }
  if (input.valueDataType === undefined || input.valueDataType === null) {
    throw new ValidationError('valueDataType is required on update', [{ field: 'valueDataType', message: 'Required' }]);
  }
  if (typeof input.valueDataType !== 'string' || !input.valueDataType.trim()) {
    throw new ValidationError('valueDataType cannot be empty', [{ field: 'valueDataType', message: 'Invalid' }]);
  }
  if (!VALUE_DATA_TYPES.includes(input.valueDataType as ValueDataType)) {
    throw new ValidationError('valueDataType must be Enum, Numeric, Boolean, or Text', [
      { field: 'valueDataType', message: 'Invalid enum' },
    ]);
  }
  if (input.multiSelectAllowed === undefined || input.multiSelectAllowed === null) {
    throw new ValidationError('multiSelectAllowed is required on update', [
      { field: 'multiSelectAllowed', message: 'Required' },
    ]);
  }
  if (typeof input.multiSelectAllowed !== 'boolean') {
    throw new ValidationError('multiSelectAllowed must be a boolean', [{ field: 'multiSelectAllowed', message: 'Invalid' }]);
  }
  if (input.applicableModules === null) {
    throw new ValidationError('applicableModules must be an array', [{ field: 'applicableModules', message: 'Invalid' }]);
  }
  if (input.applicableModules !== undefined && input.applicableModules.length > 0) {
    assertEnumTokenArray(input.applicableModules, 'applicableModules');
  }
  if (input.status === undefined || input.status === null || String(input.status).trim() === '') {
    throw new ValidationError('status is required on update', [{ field: 'status', message: 'Required' }]);
  }
  assertStatusEnum(input.status);
}

export function validateApplicability(a: Applicability): void {
  assertEnumTokenArray(a.module, 'applicability.module');
  assertEnumTokenArray(a.category, 'applicability.category');
  assertEnumTokenArray(a.condition, 'applicability.condition');
  assertEnumTokenArray(a.country, 'applicability.country');
  assertEnumTokenArray(a.language, 'applicability.language');
}

/** For non-global values, require certain applicability lists per metadata type configuration. */
export function validateMetadataValueConditionalApplicability(
  typeRecord: MetadataTypeRecord,
  isGlobal: boolean,
  applicability: Applicability,
): void {
  if (isGlobal) {
    return;
  }
  const cfg = typeRecord.valueApplicabilityConfig;
  if (!cfg) {
    return;
  }
  if (cfg.moduleScoped && !(applicability.module?.length)) {
    throw new ValidationError('applicableModules is required for this metadata type', [
      { field: 'applicableModules', message: 'Required' },
    ]);
  }
  if (cfg.categoryDependent && !(applicability.category?.length)) {
    throw new ValidationError('applicableCategories is required for this metadata type', [
      { field: 'applicableCategories', message: 'Required' },
    ]);
  }
  if (cfg.conditionDependent && !(applicability.condition?.length)) {
    throw new ValidationError('applicableConditions is required for this metadata type', [
      { field: 'applicableConditions', message: 'Required' },
    ]);
  }
  if (cfg.countryDependent && !(applicability.country?.length)) {
    throw new ValidationError('applicableCountries is required for this metadata type', [
      { field: 'applicableCountries', message: 'Required' },
    ]);
  }
  if (cfg.languageDependent && !(applicability.language?.length)) {
    throw new ValidationError('applicableLanguages is required for this metadata type', [
      { field: 'applicableLanguages', message: 'Required' },
    ]);
  }
}

export function validateMetadataValueInput(
  input: MetadataValueInput,
  opts: {
    metadataType: MetadataTypeRecord;
    mode: 'create' | 'update';
    /** Create / merged snapshot; required for update when body omits `isGlobal`. */
    mergedIsGlobal: boolean;
    /** On update, must match the stored code (immutability). */
    expectedValueCode?: string;
    /** Active QuestionType value codes (QuestionCode only); from registry when available. */
    allowedQuestionTypeCodes?: readonly string[];
  },
): void {
  assertMetadataValueCode(input.valueCode);
  if (opts.expectedValueCode !== undefined && input.valueCode !== opts.expectedValueCode) {
    throw new ValidationError('metadataValueCode (valueCode) cannot be changed', [
      { field: 'valueCode', message: 'Immutable' },
    ]);
  }
  if (input.label === null || input.label === undefined) {
    throw new ValidationError('label is required', [{ field: 'label', message: 'Required' }]);
  }
  if (typeof input.label !== 'string' || input.label.trim() === '') {
    throw new ValidationError('label is required', [{ field: 'label', message: 'Required' }]);
  }
  if (input.label.length > METADATA_VALUE_LABEL_MAX) {
    throw new ValidationError(`label must be at most ${METADATA_VALUE_LABEL_MAX} characters`, [
      { field: 'label', message: `Max ${METADATA_VALUE_LABEL_MAX} characters` },
    ]);
  }
  if (input.description !== undefined && input.description.length > METADATA_VALUE_DESCRIPTION_MAX) {
    throw new ValidationError(`description must be at most ${METADATA_VALUE_DESCRIPTION_MAX} characters`, [
      { field: 'description', message: `Max ${METADATA_VALUE_DESCRIPTION_MAX} characters` },
    ]);
  }
  if (input.status === undefined || input.status === null) {
    throw new ValidationError('status is required', [{ field: 'status', message: 'Required' }]);
  }
  assertStatusEnum(input.status, { detailMessage: 'Invalid' });
  if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) {
    throw new ValidationError('sortOrder must be a non-negative integer', [{ field: 'sortOrder', message: 'Invalid' }]);
  }
  if (opts.mode === 'create' && input.isGlobal === undefined) {
    throw new ValidationError('isGlobal is required on create', [{ field: 'isGlobal', message: 'Required boolean' }]);
  }
  if (input.isGlobal !== undefined && typeof input.isGlobal !== 'boolean') {
    throw new ValidationError('isGlobal must be a boolean', [{ field: 'isGlobal', message: 'Invalid' }]);
  }
  const effectiveGlobal = opts.mergedIsGlobal;
  validateApplicability(input.applicability);
  validateMetadataValueApplicabilityRules(effectiveGlobal, input.applicability);
  validateMetadataValueConditionalApplicability(opts.metadataType, effectiveGlobal, input.applicability);
  const { metadataTypeCode } = opts.metadataType;

  const resolvedAttrSchema = resolveValueAttributeSchemaForValidation(
    metadataTypeCode,
    opts.metadataType.attributeSchema as Record<string, unknown> | undefined,
  );
  if (resolvedAttrSchema) {
    validateAttributesAgainstSchema(input.attributes ?? {}, resolvedAttrSchema);
  }

  if (metadataTypeCode === 'MetricCode') {
    validateMetricCodeAttributes(input.attributes ?? {});
  } else if (metadataTypeCode === 'QuestionCode') {
    validateQuestionCodeAttributes(input.attributes ?? {}, {
      allowedQuestionTypeCodes: opts.allowedQuestionTypeCodes,
    });
  }
}

/** Applicability-style search filter tokens and status; call before `searchMetadataValues` on the repository. */
export function validateValueSearchFilter(filter: ValueSearchFilter): void {
  if (filter.status !== undefined && filter.status !== '') {
    const normalized =
      typeof filter.status === 'string' ? filter.status.trim().toUpperCase() : filter.status;
    assertStatusFilterEnum(normalized);
    filter.status = normalized as Status;
  }
  assertEnumTokenArray(filter.module, 'module');
  assertEnumTokenArray(filter.category, 'category');
  assertEnumTokenArray(filter.condition, 'condition');
  assertEnumTokenArray(filter.country, 'country');
  assertEnumTokenArray(filter.language, 'language');
}
