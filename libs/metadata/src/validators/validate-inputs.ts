import {
  VALUE_DATA_TYPES,
  type Applicability,
  type MetadataTypeInput,
  type MetadataTypeRecord,
  type MetadataValueInput,
  type ValueDataType,
  type ValueSearchFilter,
} from '../models/types';
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
import { assertStatusEnum } from './status';

const DISPLAY_NAME_MAX = 100;
const METADATA_VALUE_LABEL_MAX = 150;
const METADATA_VALUE_DESCRIPTION_MAX = 2000;

export function validateMetadataTypeInput(input: MetadataTypeInput, isUpdate = false): void {
  assertMetadataTypeCode(input.metadataTypeCode);
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
  if (!input.label?.trim()) {
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
    assertStatusEnum(filter.status, { message: 'Invalid status filter' });
  }
  assertEnumTokenArray(filter.module, 'module');
  assertEnumTokenArray(filter.category, 'category');
  assertEnumTokenArray(filter.condition, 'condition');
  assertEnumTokenArray(filter.country, 'country');
  assertEnumTokenArray(filter.language, 'language');
}
