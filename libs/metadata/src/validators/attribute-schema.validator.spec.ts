import { describe, expect, it } from '@jest/globals';
import { ValidationError } from '../domain/errors';
import { isAttributeSchemaCompatibleExtension } from '../domain/diff';
import {
  attributeSchemaFieldMapForCompatibility,
  resolveValueAttributeSchemaForValidation,
  validateAttributesAgainstSchema,
} from './attribute-schema.validator';

describe('validateAttributesAgainstSchema', () => {
  const schema = {
    dataType: { mandatory: true, type: 'string' as const, allowedValues: ['Numeric', 'Text'] },
    unit: { mandatory: false, type: 'string' as const },
    tags: { mandatory: false, type: 'array' as const, multiSelect: true, allowedValues: ['A', 'B'] },
  };

  it('accepts a valid payload', () => {
    expect(() =>
      validateAttributesAgainstSchema(
        { dataType: 'Numeric', unit: 'mm', tags: ['A', 'B'] },
        schema,
      ),
    ).not.toThrow();
  });

  it('rejects unsupported attribute keys', () => {
    expect(() =>
      validateAttributesAgainstSchema({ dataType: 'Numeric', randomField: 'x' } as Record<string, unknown>, schema),
    ).toThrow(ValidationError);
    try {
      validateAttributesAgainstSchema(
        { dataType: 'Numeric', randomField: 'x' } as Record<string, unknown>,
        schema,
      );
    } catch (e) {
      expect((e as ValidationError).message).toMatch(/Unsupported attribute: randomField/);
    }
  });

  it('rejects missing mandatory attributes', () => {
    expect(() => validateAttributesAgainstSchema({}, schema)).toThrow(/Missing required attribute: dataType/);
  });

  it('rejects invalid enum scalar', () => {
    expect(() => validateAttributesAgainstSchema({ dataType: 'Blob' }, schema)).toThrow(/Invalid enum value/);
  });

  it('rejects non-array multiSelect', () => {
    expect(() => validateAttributesAgainstSchema({ dataType: 'Numeric', tags: 'A' }, schema)).toThrow(/must be an array/);
  });

  it('rejects invalid enum in array', () => {
    expect(() => validateAttributesAgainstSchema({ dataType: 'Numeric', tags: ['A', 'Z'] }, schema)).toThrow(
      /Invalid enum value/,
    );
  });
});

describe('resolveValueAttributeSchemaForValidation', () => {
  it('uses intrinsic MetricCode fields when stored schema parses empty', () => {
    const s = resolveValueAttributeSchemaForValidation('MetricCode', {});
    expect(s).not.toBeNull();
    expect(s?.dataType?.mandatory).toBe(true);
    expect(s?.supportedSourceTypes?.multiSelect).toBe(true);
  });

  it('uses explicit type schema when present', () => {
    const s = resolveValueAttributeSchemaForValidation('MetricCode', {
      attributes: [{ name: 'dataType', mandatory: true, type: 'String', allowedValues: ['Numeric'] }],
    });
    expect(Object.keys(s ?? {})).toEqual(['dataType']);
  });

  it('returns null for generic types with no schema', () => {
    expect(resolveValueAttributeSchemaForValidation('Country', undefined)).toBeNull();
  });
});

describe('attributeSchemaFieldMapForCompatibility', () => {
  it('works with isAttributeSchemaCompatibleExtension for additive defs', () => {
    const before = attributeSchemaFieldMapForCompatibility({
      attributes: [{ name: 'a', mandatory: true, type: 'String' }],
    });
    const after = attributeSchemaFieldMapForCompatibility({
      attributes: [
        { name: 'a', mandatory: true, type: 'String' },
        { name: 'b', mandatory: false, type: 'String' },
      ],
    });
    expect(isAttributeSchemaCompatibleExtension(before, after)).toBe(true);
  });

  it('detects incompatible definition change', () => {
    const before = attributeSchemaFieldMapForCompatibility({
      attributes: [{ name: 'a', mandatory: true, type: 'String' }],
    });
    const after = attributeSchemaFieldMapForCompatibility({
      attributes: [{ name: 'a', mandatory: false, type: 'String' }],
    });
    expect(isAttributeSchemaCompatibleExtension(before, after)).toBe(false);
  });
});
