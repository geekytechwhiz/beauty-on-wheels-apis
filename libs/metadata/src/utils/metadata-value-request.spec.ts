import { describe, expect, it } from '@jest/globals';
import {
  mapFlatAndNestedToApplicability,
  normalizeApplicabilityTokens,
  validateMetadataValueApplicabilityRules,
} from './metadata-value-request';
import { ValidationError } from '../domain/errors';

describe('normalizeApplicabilityTokens', () => {
  it('trims, uppercases, dedupes', () => {
    expect(normalizeApplicabilityTokens([' a ', 'A', 'b', 'B '])).toEqual(['A', 'B']);
  });
  it('returns empty for undefined', () => {
    expect(normalizeApplicabilityTokens(undefined)).toEqual([]);
  });
});

describe('mapFlatAndNestedToApplicability', () => {
  it('maps flat only', () => {
    const out = mapFlatAndNestedToApplicability({
      applicableModules: ['clinical', 'clinical'],
      applicableCategories: ['post_op'],
      applicableConditions: [],
      applicableCountries: ['us'],
      applicableLanguages: ['en'],
    });
    expect(out).toEqual({
      module: ['CLINICAL'],
      category: ['POST_OP'],
      condition: [],
      country: ['US'],
      language: ['EN'],
    });
  });

  it('uses nested when flat not present', () => {
    const out = mapFlatAndNestedToApplicability(
      {},
      {
        module: ['M'],
        category: [],
        condition: [],
        country: [],
        language: ['EN'],
      },
    );
    expect(out.module).toEqual(['M']);
    expect(out.language).toEqual(['EN']);
  });

  it('throws if flat is not array', () => {
    expect(() =>
      mapFlatAndNestedToApplicability({
        applicableModules: 'x' as unknown as string[],
      }),
    ).toThrow(ValidationError);
  });
});

describe('validateMetadataValueApplicabilityRules', () => {
  const scoped = {
    module: ['M'],
    category: [],
    condition: [],
    country: [],
  };

  it('allows global with all empty', () => {
    expect(() =>
      validateMetadataValueApplicabilityRules(true, {
        module: [],
        category: [],
        condition: [],
        country: [],
      }),
    ).not.toThrow();
  });

  it('rejects global with tokens', () => {
    expect(() => validateMetadataValueApplicabilityRules(true, scoped)).toThrow(ValidationError);
  });

  it('requires non-global to have at least one token', () => {
    expect(() =>
      validateMetadataValueApplicabilityRules(false, {
        module: [],
        category: [],
        condition: [],
        country: [],
      }),
    ).toThrow(ValidationError);
  });

  it('accepts non-global with module only', () => {
    expect(() => validateMetadataValueApplicabilityRules(false, scoped)).not.toThrow();
  });
});
