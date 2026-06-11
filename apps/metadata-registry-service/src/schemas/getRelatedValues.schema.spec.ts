import { ValidationError } from '@api-hub/metadata';

import { getRelatedValuesSchema } from './getRelatedValues.schema';

describe('getRelatedValuesSchema', () => {
  it('parses a single fromValue (backward compatible) into fromValues array', () => {
    const out = getRelatedValuesSchema.parse({
      params: { fromType: 'Country', fromValue: 'IN' },
    });
    expect(out).toEqual({
      fromType: 'Country',
      fromValues: ['IN'],
      relationType: undefined,
      toType: undefined,
    });
  });

  it('parses repeated query params from multiValueQueryStringParameters', () => {
    const out = getRelatedValuesSchema.parse({
      params: { fromType: 'Country', fromValue: 'US' },
      event: { multiValueQueryStringParameters: { fromValue: ['IN', 'US'] } },
    });
    expect(out.fromValues).toEqual(['IN', 'US']);
  });

  it('parses comma-separated fromValue', () => {
    const out = getRelatedValuesSchema.parse({
      params: { fromType: 'Country', fromValue: 'IN,US' },
    });
    expect(out.fromValues).toEqual(['IN', 'US']);
  });

  it('trims values and removes empty entries', () => {
    const out = getRelatedValuesSchema.parse({
      params: { fromType: 'Country', fromValue: ' IN , , US ,' },
    });
    expect(out.fromValues).toEqual(['IN', 'US']);
  });

  it('dedupes repeated source values (first occurrence wins, order preserved)', () => {
    const out = getRelatedValuesSchema.parse({
      params: { fromType: 'Country', fromValue: 'IN,US,IN' },
    });
    expect(out.fromValues).toEqual(['IN', 'US']);
  });

  it('passes through relationType and toType (with alias)', () => {
    const out = getRelatedValuesSchema.parse({
      params: {
        fromType: 'Country',
        fromValue: 'IN',
        relationType: 'PARENT_CHILD',
        toMetadataTypeCode: 'State',
      },
    });
    expect(out.relationType).toBe('PARENT_CHILD');
    expect(out.toType).toBe('State');
  });

  it('rejects an invalid value in the list', () => {
    expect(() =>
      getRelatedValuesSchema.parse({
        params: { fromType: 'Country', fromValue: 'IN,not a code!' },
      }),
    ).toThrow(ValidationError);
  });

  it('rejects when fromType is missing', () => {
    expect(() =>
      getRelatedValuesSchema.parse({ params: { fromValue: 'IN' } }),
    ).toThrow(ValidationError);
  });

  it('rejects when no usable fromValue remains', () => {
    expect(() =>
      getRelatedValuesSchema.parse({ params: { fromType: 'Country', fromValue: '  ,  ' } }),
    ).toThrow(ValidationError);
  });
});
