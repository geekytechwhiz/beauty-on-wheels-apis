import type { MetadataDefinition } from '../domain/metadata-definition.types';
import { TemplateValidationError } from '../shared/template.errors';

/**
 * Collect object keys equal to `fieldName` anywhere under `root` (including nested objects/arrays).
 */
export function collectValuesForFieldName(
  root: unknown,
  fieldName: string,
  basePath = '',
): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  if (root === null || root === undefined) {
    return out;
  }
  if (Array.isArray(root)) {
    root.forEach((item, i) => {
      const p = basePath ? `${basePath}[${i}]` : `[${i}]`;
      out.push(...collectValuesForFieldName(item, fieldName, p));
    });
    return out;
  }
  if (typeof root === 'object') {
    const rec = root as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      const p = basePath ? `${basePath}.${k}` : k;
      if (k === fieldName) {
        out.push({ path: p, value: v });
      }
      out.push(...collectValuesForFieldName(v, fieldName, p));
    }
  }
  return out;
}

function assertEnumLike(
  def: MetadataDefinition,
  raw: string,
  fieldPath: string,
): void {
  const allowed = def.values ?? [];
  if (allowed.length === 0) {
    return;
  }
  if (allowed.includes(raw)) {
    return;
  }
  switch (def.metadataMode) {
    case 'Fixed':
      throw new TemplateValidationError(
        `Value "${raw}" is not allowed for metadata "${def.name}"`,
        'TEMPLATE.METADATA_ENUM_VIOLATION',
        undefined,
        { value: raw, allowed },
        fieldPath,
        def.name,
      );
    case 'Expandable':
    case 'FixedDefaultExpandable':
      return;
    default:
      throw new TemplateValidationError(
        `Unsupported metadataMode for ${def.name}`,
        'TEMPLATE.METADATA_MODE_UNSUPPORTED',
        undefined,
        undefined,
        fieldPath,
        def.name,
      );
  }
}

function validateNumeric(def: MetadataDefinition, value: number, fieldPath: string): void {
  const c = def.constraints;
  if (c?.minValue !== undefined && value < c.minValue) {
    throw new TemplateValidationError(
      `Numeric value below min for "${def.name}"`,
      'TEMPLATE.METADATA_NUMERIC_MIN',
      undefined,
      { min: c.minValue, value },
      fieldPath,
      def.name,
    );
  }
  if (c?.maxValue !== undefined && value > c.maxValue) {
    throw new TemplateValidationError(
      `Numeric value above max for "${def.name}"`,
      'TEMPLATE.METADATA_NUMERIC_MAX',
      undefined,
      { max: c.maxValue, value },
      fieldPath,
      def.name,
    );
  }
}

function validateStringConstraints(def: MetadataDefinition, raw: string, fieldPath: string): void {
  const c = def.constraints;
  if (c?.minLength !== undefined && raw.length < c.minLength) {
    throw new TemplateValidationError(
      `String too short for "${def.name}"`,
      'TEMPLATE.METADATA_STRING_MIN_LENGTH',
      undefined,
      { minLength: c.minLength, length: raw.length },
      fieldPath,
      def.name,
    );
  }
  if (c?.maxLength !== undefined && raw.length > c.maxLength) {
    throw new TemplateValidationError(
      `String too long for "${def.name}"`,
      'TEMPLATE.METADATA_STRING_MAX_LENGTH',
      undefined,
      { maxLength: c.maxLength, length: raw.length },
      fieldPath,
      def.name,
    );
  }
  if (c?.regex !== undefined && c.regex.trim() !== '') {
    let re: RegExp;
    try {
      re = new RegExp(c.regex);
    } catch {
      throw new TemplateValidationError(
        `Invalid regex in metadata registry for "${def.name}"`,
        'TEMPLATE.METADATA_REGEX_INVALID',
        undefined,
        { regex: c.regex },
        fieldPath,
        def.name,
      );
    }
    if (!re.test(raw)) {
      throw new TemplateValidationError(
        `String does not match pattern for "${def.name}"`,
        'TEMPLATE.METADATA_REGEX_VIOLATION',
        undefined,
        { regex: c.regex },
        fieldPath,
        def.name,
      );
    }
  }
}

/**
 * Validates config values that correspond to applicable metadata definitions (by matching field name).
 */
export function validateConfigAgainstApplicableMetadata(
  config: Record<string, unknown>,
  applicable: MetadataDefinition[],
): void {
  for (const def of applicable) {
    const hits = collectValuesForFieldName(config, def.name);
    if (hits.length === 0) {
      continue;
    }

    switch (def.type) {
      case 'ENUM': {
        for (const { path, value } of hits) {
          if (typeof value !== 'string') {
            throw new TemplateValidationError(
              `Expected string for ENUM metadata "${def.name}"`,
              'TEMPLATE.METADATA_TYPE_MISMATCH',
              undefined,
              { expected: 'string', actual: typeof value },
              path,
              def.name,
            );
          }
          assertEnumLike(def, value, path);
          validateStringConstraints(def, value, path);
        }
        break;
      }
      case 'MULTI_ENUM': {
        for (const { path, value } of hits) {
          if (!Array.isArray(value)) {
            throw new TemplateValidationError(
              `Expected array for MULTI_ENUM metadata "${def.name}"`,
              'TEMPLATE.METADATA_TYPE_MISMATCH',
              undefined,
              undefined,
              path,
              def.name,
            );
          }
          const strs = value.map((v) => {
            if (typeof v !== 'string') {
              throw new TemplateValidationError(
                `MULTI_ENUM "${def.name}" must contain only strings`,
                'TEMPLATE.METADATA_TYPE_MISMATCH',
                undefined,
                undefined,
                path,
                def.name,
              );
            }
            return v;
          });
          const c = def.constraints;
          if (c?.minSelections !== undefined && strs.length < c.minSelections) {
            throw new TemplateValidationError(
              `Too few selections for "${def.name}"`,
              'TEMPLATE.METADATA_SELECTIONS_MIN',
              undefined,
              { minSelections: c.minSelections, count: strs.length },
              path,
              def.name,
            );
          }
          if (c?.maxSelections !== undefined && strs.length > c.maxSelections) {
            throw new TemplateValidationError(
              `Too many selections for "${def.name}"`,
              'TEMPLATE.METADATA_SELECTIONS_MAX',
              undefined,
              { maxSelections: c.maxSelections, count: strs.length },
              path,
              def.name,
            );
          }
          const allowed = def.values ?? [];
          for (const s of strs) {
            if (allowed.length > 0 && !allowed.includes(s) && def.metadataMode === 'Fixed') {
              throw new TemplateValidationError(
                `Selection "${s}" is not allowed for "${def.name}"`,
                'TEMPLATE.METADATA_ENUM_VIOLATION',
                undefined,
                { value: s, allowed },
                path,
                def.name,
              );
            }
            if (allowed.length > 0 && !allowed.includes(s) && def.metadataMode !== 'Fixed') {
              // Expandable / FixedDefaultExpandable: non-listed values allowed
            }
          }
        }
        break;
      }
      case 'NUMERIC': {
        for (const { path, value } of hits) {
          if (typeof value !== 'number' || Number.isNaN(value)) {
            throw new TemplateValidationError(
              `Expected number for NUMERIC metadata "${def.name}"`,
              'TEMPLATE.METADATA_TYPE_MISMATCH',
              undefined,
              undefined,
              path,
              def.name,
            );
          }
          validateNumeric(def, value, path);
        }
        break;
      }
      case 'BOOLEAN': {
        for (const { path, value } of hits) {
          if (typeof value !== 'boolean') {
            throw new TemplateValidationError(
              `Expected boolean for BOOLEAN metadata "${def.name}"`,
              'TEMPLATE.METADATA_TYPE_MISMATCH',
              undefined,
              undefined,
              path,
              def.name,
            );
          }
        }
        break;
      }
      case 'STRING': {
        for (const { path, value } of hits) {
          if (typeof value !== 'string') {
            throw new TemplateValidationError(
              `Expected string for STRING metadata "${def.name}"`,
              'TEMPLATE.METADATA_TYPE_MISMATCH',
              undefined,
              undefined,
              path,
              def.name,
            );
          }
          validateStringConstraints(def, value, path);
          const allowed = def.values ?? [];
          if (allowed.length > 0 && def.metadataMode === 'Fixed' && !allowed.includes(value)) {
            throw new TemplateValidationError(
              `Value not in allowed set for "${def.name}"`,
              'TEMPLATE.METADATA_ENUM_VIOLATION',
              undefined,
              { value, allowed },
              path,
              def.name,
            );
          }
        }
        break;
      }
      default: {
        throw new TemplateValidationError(
          `Unsupported metadata field type for "${def.name}"`,
          'TEMPLATE.METADATA_TYPE_UNSUPPORTED',
          undefined,
          undefined,
          undefined,
          def.name,
        );
      }
    }

    if (def.defaultValue !== undefined && def.metadataMode === 'Fixed') {
      const dv = def.defaultValue;
      if (def.type === 'ENUM' && typeof dv === 'string' && def.values && def.values.length > 0 && !def.values.includes(dv)) {
        throw new TemplateValidationError(
          `Registry defaultValue for "${def.name}" is not in values[]`,
          'TEMPLATE.METADATA_DEFAULT_INVALID',
          undefined,
          undefined,
          undefined,
          def.name,
        );
      }
    }
  }
}
