import {
  VALUE_DATA_TYPES,
  type Applicability,
  type MetadataTypeInput,
  type MetadataValueInput,
  type ValueDataType,
} from '../domain/types';
import { STATUS } from '../domain/constants';
import { ValidationError } from '../domain/errors';
import { assertEnumTokenArray, assertMetadataTypeCode, assertMetadataValueCode } from './code-patterns';
import { validateMetricCodeAttributes } from './metric-code.schema';
import { validateQuestionCodeAttributes } from './question-code.schema';
import { validateMetadataValueApplicabilityRules } from '../utils/metadata-value-request';

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
    if (!input.applicableModules?.length) {
      throw new ValidationError('applicableModules must contain at least one module', [
        { field: 'applicableModules', message: 'Required' },
      ]);
    }
    assertEnumTokenArray(input.applicableModules, 'applicableModules');
    if (input.status === undefined || input.status === null || String(input.status).trim() === '') {
      throw new ValidationError('status is required on create', [{ field: 'status', message: 'Required' }]);
    }
    if (input.status !== STATUS.ACTIVE && input.status !== STATUS.INACTIVE) {
      throw new ValidationError('status must be ACTIVE or INACTIVE', [
        { field: 'status', message: 'Must be ACTIVE or INACTIVE' },
      ]);
    }
    return;
  }

  if (input.displayName !== undefined) {
    if (!input.displayName.trim()) {
      throw new ValidationError('displayName cannot be empty', [{ field: 'displayName', message: 'Invalid' }]);
    }
    if (input.displayName.length > DISPLAY_NAME_MAX) {
      throw new ValidationError(`displayName must be at most ${DISPLAY_NAME_MAX} characters`, [
        { field: 'displayName', message: `Max ${DISPLAY_NAME_MAX} characters` },
      ]);
    }
  }
  if (input.valueDataType !== undefined && !VALUE_DATA_TYPES.includes(input.valueDataType as ValueDataType)) {
    throw new ValidationError('valueDataType must be Enum, Numeric, Boolean, or Text', [
      { field: 'valueDataType', message: 'Invalid enum' },
    ]);
  }
  if (input.applicableModules !== undefined) {
    if (!input.applicableModules.length) {
      throw new ValidationError('applicableModules must contain at least one module', [
        { field: 'applicableModules', message: 'Invalid' },
      ]);
    }
    assertEnumTokenArray(input.applicableModules, 'applicableModules');
  }
  if (input.multiSelectAllowed !== undefined && typeof input.multiSelectAllowed !== 'boolean') {
    throw new ValidationError('multiSelectAllowed must be a boolean', [{ field: 'multiSelectAllowed', message: 'Invalid' }]);
  }
  if (input.status !== undefined && input.status !== STATUS.ACTIVE && input.status !== STATUS.INACTIVE) {
    throw new ValidationError('status must be ACTIVE or INACTIVE', [
      { field: 'status', message: 'Must be ACTIVE or INACTIVE' },
    ]);
  }
}

export function validateApplicability(a: Applicability): void {
  assertEnumTokenArray(a.module, 'applicability.module');
  assertEnumTokenArray(a.category, 'applicability.category');
  assertEnumTokenArray(a.condition, 'applicability.condition');
  assertEnumTokenArray(a.country, 'applicability.country');
  assertEnumTokenArray(a.language, 'applicability.language');
}

export function validateMetadataValueInput(
  input: MetadataValueInput,
  opts: {
    valueDataType?: string;
    metadataTypeCode: string;
    mode?: 'create' | 'update';
    /** Required for update (merged with stored record); may be omitted when `input.isGlobal` is set on create. */
    mergedIsGlobal?: boolean;
  },
): void {
  assertMetadataValueCode(input.valueCode);
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
  const mode = opts.mode ?? 'update';
  if (mode === 'create' && input.isGlobal === undefined) {
    throw new ValidationError('isGlobal is required on create', [{ field: 'isGlobal', message: 'Required boolean' }]);
  }
  if (input.isGlobal !== undefined && typeof input.isGlobal !== 'boolean') {
    throw new ValidationError('isGlobal must be a boolean', [{ field: 'isGlobal', message: 'Invalid' }]);
  }
  const effectiveGlobal = opts.mergedIsGlobal ?? input.isGlobal;
  if (effectiveGlobal === undefined) {
    throw new ValidationError('isGlobal is required for validation', [{ field: 'isGlobal', message: 'Required' }]);
  }
  validateApplicability(input.applicability);
  validateMetadataValueApplicabilityRules(effectiveGlobal, input.applicability);
  const { metadataTypeCode } = opts;
  if (metadataTypeCode === 'MetricCode') {
    validateMetricCodeAttributes(input.attributes ?? {});
  } else if (metadataTypeCode === 'QuestionCode') {
    validateQuestionCodeAttributes(input.attributes ?? {});
  }
}
