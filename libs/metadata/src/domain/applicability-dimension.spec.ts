import { describe, expect, it } from '@jest/globals';
import { collectApplicabilityDimensionIndexKeys } from './applicability-dimension';
import { applDimensionPartitionKey } from './keys';

describe('applicability dimension index', () => {
  it('builds expected partition key', () => {
    expect(applDimensionPartitionKey('COUNTRY')).toBe('APPL_DIMENSION#COUNTRY');
  });

  it('collects unique PK+SK pairs and skips empty and wildcard', () => {
    const keys = collectApplicabilityDimensionIndexKeys({
      module: ['PROVIDER'],
      category: [],
      condition: ['POST_OP'],
      country: ['US', 'US', '*'],
      language: ['EN'],
    });
    const pks = new Set(keys.map((k) => k.pk));
    expect(pks.has('APPL_DIMENSION#MODULE')).toBe(true);
    expect(pks.has('APPL_DIMENSION#CATEGORY')).toBe(false);
    expect(keys).toContainEqual({ pk: 'APPL_DIMENSION#COUNTRY', sk: 'US' });
    expect(keys).toContainEqual({ pk: 'APPL_DIMENSION#CONDITION', sk: 'POST_OP' });
    expect(keys).toContainEqual({ pk: 'APPL_DIMENSION#LANGUAGE', sk: 'EN' });
    expect(keys.filter((k) => k.sk === '*')).toHaveLength(0);
  });
});
