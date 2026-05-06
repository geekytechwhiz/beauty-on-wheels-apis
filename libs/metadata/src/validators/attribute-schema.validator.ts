import { metadataTypeUsesSeparateSchemaItem } from '../constants';
import { ValidationError } from '../domain/errors';
import {
  DATA_SOURCE_TYPES,
  DIRECTIONALITY_TYPES,
  EVALUATION_LOGIC_TYPES,
  METRIC_VALUE_DATA_TYPES,
} from './metric-code.schema';

/**
 * Normalized field definition for value `attributes` validation (populated from type `attributeSchema` or intrinsics).
 */
export interface AttributeFieldDefinition {
  mandatory?: boolean;
  /** Logical value type of this attribute on the metadata value. */
  type?: 'string' | 'number' | 'boolean' | 'array';
  allowedValues?: readonly string[];
  multiSelect?: boolean;
}

const RESERVED_SCHEMA_KEYS = new Set(['attributes', 'properties']);

/** Map API / persisted schema `type` / `dataType` tokens to normalized `type`. */
function parseFieldType(raw: unknown): 'string' | 'number' | 'boolean' | 'array' | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const s = String(raw).trim().toLowerCase();
  if (s === 'string' || s === 'str' || s === 'text' || s === 'enum') {
    return 'string';
  }
  if (s === 'number' || s === 'numeric' || s === 'float' || s === 'integer' || s === 'int') {
    return 'number';
  }
  if (s === 'boolean' || s === 'bool') {
    return 'boolean';
  }
  if (s === 'array' || s === 'list' || s === 'strings' || s === 'multiselect') {
    return 'array';
  }
  return undefined;
}

function parseFieldDefinition(obj: Record<string, unknown>): AttributeFieldDefinition {
  const mandatoryRaw = obj.mandatory ?? obj.required;
  const mandatory = mandatoryRaw === true || mandatoryRaw === 'true';

  const type =
    parseFieldType(obj.type) ??
    parseFieldType(obj.dataType) ??
    parseFieldType(obj.valueType);

  const multiSelect =
    obj.multiSelect === true ||
    obj.multiSelect === 'true' ||
    obj.multiSelectAllowed === true ||
    obj.multiSelectAllowed === 'true';

  let allowedValues: string[] | undefined;
  if (Array.isArray(obj.allowedValues)) {
    allowedValues = obj.allowedValues.map((x) => String(x));
  }

  return {
    mandatory,
    type,
    allowedValues,
    multiSelect,
  };
}

/**
 * Extract field definitions from a persisted / request `attributeSchema` shape without applying type intrinsics.
 * Supports:
 * - `{ attributes: [{ name, mandatory?, type?, allowedValues?, multiSelect? }] }`
 * - `{ properties: { fieldName: { ...def } } }`
 * - `{ fieldName: { mandatory, type, ... } }` (flat)
 */
export function parseAttributeSchemaDefinitions(
  raw: Record<string, unknown> | undefined,
): Record<string, AttributeFieldDefinition> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  if (Array.isArray(raw.attributes)) {
    const out: Record<string, AttributeFieldDefinition> = {};
    for (const item of raw.attributes) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const name = rec.name ?? rec.key ?? rec.field;
      if (typeof name !== 'string' || !name.trim()) {
        continue;
      }
      out[name.trim()] = parseFieldDefinition(rec);
    }
    return out;
  }

  if (raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties)) {
    const props = raw.properties as Record<string, unknown>;
    const out: Record<string, AttributeFieldDefinition> = {};
    for (const [k, v] of Object.entries(props)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        continue;
      }
      out[k] = parseFieldDefinition(v as Record<string, unknown>);
    }
    return out;
  }

  const out: Record<string, AttributeFieldDefinition> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (RESERVED_SCHEMA_KEYS.has(k)) {
      continue;
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      continue;
    }
    out[k] = parseFieldDefinition(v as Record<string, unknown>);
  }
  return out;
}

function intrinsicMetricFieldSchema(): Record<string, AttributeFieldDefinition> {
  return {
    dataType: {
      mandatory: true,
      type: 'string',
      allowedValues: [...METRIC_VALUE_DATA_TYPES],
      multiSelect: false,
    },
    unit: { mandatory: false, type: 'string' },
    supportedSourceTypes: {
      mandatory: false,
      type: 'array',
      allowedValues: [...DATA_SOURCE_TYPES],
      multiSelect: true,
    },
    supportedEvaluationLogic: {
      mandatory: false,
      type: 'array',
      allowedValues: [...EVALUATION_LOGIC_TYPES],
      multiSelect: true,
    },
    directionality: {
      mandatory: false,
      type: 'string',
      allowedValues: [...DIRECTIONALITY_TYPES],
      multiSelect: false,
    },
    decimalAllowed: { mandatory: false, type: 'boolean' },
    minSupportedValue: { mandatory: false, type: 'number' },
    maxSupportedValue: { mandatory: false, type: 'number' },
  };
}

function intrinsicQuestionFieldSchema(): Record<string, AttributeFieldDefinition> {
  return {
    questionText: { mandatory: true, type: 'string' },
    questionType: {
      mandatory: true,
      type: 'string',
      // enum enforced separately via QuestionType metadata codes
    },
    answerScale: { mandatory: false, type: 'string' },
    thresholdEligible: { mandatory: true, type: 'boolean' },
  };
}

/** Product default schema for MetricCode / QuestionCode when type `attributeSchema` parses empty. */
export function getIntrinsicValueAttributeSchema(metadataTypeCode: string): Record<string, AttributeFieldDefinition> | null {
  if (metadataTypeCode === 'MetricCode') {
    return intrinsicMetricFieldSchema();
  }
  if (metadataTypeCode === 'QuestionCode') {
    return intrinsicQuestionFieldSchema();
  }
  return null;
}

/**
 * Resolves the effective field-level schema used to validate metadata value `attributes`.
 */
export function resolveValueAttributeSchemaForValidation(
  metadataTypeCode: string,
  storedAttributeSchema: Record<string, unknown> | undefined,
): Record<string, AttributeFieldDefinition> | null {
  const parsed = parseAttributeSchemaDefinitions(storedAttributeSchema);
  if (Object.keys(parsed).length > 0) {
    return parsed;
  }
  if (metadataTypeUsesSeparateSchemaItem(metadataTypeCode)) {
    return getIntrinsicValueAttributeSchema(metadataTypeCode);
  }
  return null;
}

function stableFieldDef(def: AttributeFieldDefinition): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (def.mandatory !== undefined) {
    o.mandatory = def.mandatory;
  }
  if (def.type !== undefined) {
    o.type = def.type;
  }
  if (def.multiSelect !== undefined) {
    o.multiSelect = def.multiSelect;
  }
  if (def.allowedValues !== undefined) {
    o.allowedValues = [...def.allowedValues].slice().sort();
  }
  return o;
}

/**
 * Flat map of field name → comparable definition object for {@link isAttributeSchemaCompatibleExtension}.
 */
export function attributeSchemaFieldMapForCompatibility(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const parsed = parseAttributeSchemaDefinitions(raw);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(parsed).sort()) {
    out[k] = stableFieldDef(parsed[k]);
  }
  return out;
}

function checkAllowedValuesScalar(
  value: unknown,
  allowed: readonly string[],
  field: string,
): void {
  const s = typeof value === 'string' ? value : String(value);
  if (!allowed.includes(s)) {
    throw new ValidationError(`Invalid enum value for ${field}`, [
      {
        field: `attributes.${field}`,
        message: `Must be one of: ${allowed.join(', ')}`,
      },
    ]);
  }
}

function checkAllowedValuesEach(
  items: unknown[],
  allowed: readonly string[],
  field: string,
): void {
  for (const item of items) {
    const s = typeof item === 'string' ? item : String(item);
    if (!allowed.includes(s)) {
      throw new ValidationError(`Invalid enum value for ${field}`, [
        {
          field: `attributes.${field}`,
          message: `Each value must be one of: ${allowed.join(', ')}`,
        },
      ]);
    }
  }
}

/**
 * Validates metadata value `attributes` against a resolved attribute schema (field definitions).
 * - Rejects keys not present in the schema
 * - Enforces `mandatory`, types, `multiSelect`, and `allowedValues` when provided
 */
export function validateAttributesAgainstSchema(
  attributes: Record<string, unknown>,
  schema: Record<string, AttributeFieldDefinition>,
): void {
  for (const key of Object.keys(attributes)) {
    if (!(key in schema)) {
      throw new ValidationError(`Unsupported attribute: ${key}`, [
        { field: `attributes.${key}`, message: 'Not defined in attributeSchema for this metadata type' },
      ]);
    }
  }

  for (const [field, def] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(attributes, field);
    const raw = attributes[field];

    if (def.mandatory && (!present || raw === undefined || raw === null)) {
      throw new ValidationError(`Missing required attribute: ${field}`, [
        { field: `attributes.${field}`, message: 'Required by attributeSchema' },
      ]);
    }
    if (!present || raw === undefined || raw === null) {
      continue;
    }

    const effectiveType =
      def.type ??
      (def.multiSelect ? 'array' : def.allowedValues?.length ? 'string' : undefined);

    if (def.multiSelect || effectiveType === 'array') {
      if (!Array.isArray(raw)) {
        throw new ValidationError(`Attribute ${field} must be an array`, [
          { field: `attributes.${field}`, message: 'Expected array (multi-select)' },
        ]);
      }
      if (def.allowedValues?.length) {
        checkAllowedValuesEach(raw, def.allowedValues, field);
      } else if (def.type === 'number') {
        for (const item of raw) {
          if (typeof item !== 'number' || !Number.isFinite(item)) {
            throw new ValidationError(`Attribute ${field} array entries must be numbers`, [
              { field: `attributes.${field}`, message: 'Invalid' },
            ]);
          }
        }
      } else if (def.type === 'string') {
        for (const item of raw) {
          if (typeof item !== 'string') {
            throw new ValidationError(`Attribute ${field} array entries must be strings`, [
              { field: `attributes.${field}`, message: 'Invalid' },
            ]);
          }
        }
      }
      continue;
    }

    if (effectiveType === 'boolean') {
      if (typeof raw !== 'boolean') {
        throw new ValidationError(`Attribute ${field} must be a boolean`, [
          { field: `attributes.${field}`, message: 'Invalid' },
        ]);
      }
    } else if (effectiveType === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new ValidationError(`Attribute ${field} must be a number`, [
          { field: `attributes.${field}`, message: 'Invalid' },
        ]);
      }
    } else if (effectiveType === 'string') {
      if (typeof raw !== 'string') {
        throw new ValidationError(`Attribute ${field} must be a string`, [
          { field: `attributes.${field}`, message: 'Invalid' },
        ]);
      }
    } else if (def.allowedValues?.length) {
      if (typeof raw !== 'string') {
        throw new ValidationError(`Attribute ${field} must be a string`, [
          { field: `attributes.${field}`, message: 'Invalid' },
        ]);
      }
    }

    if (def.allowedValues?.length && !def.multiSelect) {
      checkAllowedValuesScalar(raw, def.allowedValues, field);
    }
  }
}
