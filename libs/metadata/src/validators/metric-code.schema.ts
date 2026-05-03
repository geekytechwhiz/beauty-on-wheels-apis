import { ValidationError } from '../domain/errors';

/** Base metric value type (metadata value attributes for MetricCode type). */
export const METRIC_VALUE_DATA_TYPES = ['Numeric', 'Text', 'Boolean'] as const;
export type MetricValueDataType = (typeof METRIC_VALUE_DATA_TYPES)[number];

/** Governed list: allowed input sources. */
export const DATA_SOURCE_TYPES = ['Device', 'Manual', 'HMS'] as const;

/** Governed list: KR evaluation logic. */
export const EVALUATION_LOGIC_TYPES = [
  'LatestValue',
  'Average',
  'RollingAverage',
  'ThresholdBased',
] as const;

export const DIRECTIONALITY_TYPES = ['IncreaseBetter', 'DecreaseBetter', 'Neutral'] as const;

function isString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

function isEnum<T extends readonly string[]>(v: unknown, allowed: T, field: string): v is T[number] {
  if (typeof v !== 'string' || !allowed.includes(v as T[number])) {
    throw new ValidationError(`Invalid ${field}`, [{ field: `attributes.${field}`, message: `Must be one of: ${allowed.join(', ')}` }]);
  }
  return true;
}

function optionalEnumArray<T extends readonly string[]>(
  v: unknown,
  allowed: T,
  field: string,
): void {
  if (v === undefined) {
    return;
  }
  if (!Array.isArray(v)) {
    throw new ValidationError(`Invalid ${field}`, [{ field: `attributes.${field}`, message: 'Must be an array when present' }]);
  }
  for (const item of v) {
    if (typeof item !== 'string' || !(allowed as readonly string[]).includes(item)) {
      throw new ValidationError(`Invalid ${field}`, [{ field: `attributes.${field}`, message: `Each value must be one of: ${allowed.join(', ')}` }]);
    }
  }
}

/**
 * Validates MetricCode `value.attributes` (value-level structured fields).
 * Only `dataType` is mandatory; all other fields are optional per product rules.
 */
export function validateMetricCodeAttributes(attributes: Record<string, unknown>): void {
  if (!isString(attributes.dataType)) {
    throw new ValidationError('MetricCode attributes require dataType', [
      { field: 'attributes.dataType', message: 'Required (Numeric, Text, or Boolean)' },
    ]);
  }
  isEnum(attributes.dataType, METRIC_VALUE_DATA_TYPES, 'dataType');

  if (attributes.unit !== undefined && typeof attributes.unit !== 'string') {
    throw new ValidationError('unit must be a string', [{ field: 'attributes.unit', message: 'Invalid' }]);
  }

  optionalEnumArray(attributes.supportedSourceTypes, DATA_SOURCE_TYPES, 'supportedSourceTypes');
  optionalEnumArray(attributes.supportedEvaluationLogic, EVALUATION_LOGIC_TYPES, 'supportedEvaluationLogic');

  if (attributes.directionality !== undefined) {
    isEnum(attributes.directionality, DIRECTIONALITY_TYPES, 'directionality');
  }

  if (attributes.decimalAllowed !== undefined && typeof attributes.decimalAllowed !== 'boolean') {
    throw new ValidationError('decimalAllowed must be boolean', [{ field: 'attributes.decimalAllowed', message: 'Invalid' }]);
  }

  if (attributes.minSupportedValue !== undefined && typeof attributes.minSupportedValue !== 'number') {
    throw new ValidationError('minSupportedValue must be a number', [{ field: 'attributes.minSupportedValue', message: 'Invalid' }]);
  }
  if (attributes.maxSupportedValue !== undefined && typeof attributes.maxSupportedValue !== 'number') {
    throw new ValidationError('maxSupportedValue must be a number', [{ field: 'attributes.maxSupportedValue', message: 'Invalid' }]);
  }
}
