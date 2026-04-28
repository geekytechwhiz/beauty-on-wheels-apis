import { describe, expect, it } from '@jest/globals';
import { STATUS } from './constants';
import { matchesSearchFilter, sortValuesForSearch } from './search-filter';
import type { MetadataValueRecord } from './types';

function v(partial: Partial<MetadataValueRecord> & Pick<MetadataValueRecord, 'valueCode'>): MetadataValueRecord {
  return {
    metadataTypeCode: 'T',
    version: 1,
    label: partial.label ?? 'L',
    sortOrder: partial.sortOrder ?? 0,
    status: partial.status ?? STATUS.ACTIVE,
    isGlobal: partial.isGlobal ?? false,
    attributes: {},
    applicability: partial.applicability ?? {
      module: [],
      category: [],
      condition: [],
      country: [],
    },
    applSkKeys: [],
    createdAt: '',
    lastModifiedAt: '',
    ...partial,
  } as MetadataValueRecord;
}

describe('matchesSearchFilter', () => {
  it('defaults to ACTIVE and excludes inactive', () => {
    const active = v({ valueCode: 'A', status: STATUS.ACTIVE });
    const inactive = v({ valueCode: 'B', status: STATUS.INACTIVE });
    expect(matchesSearchFilter(active, {})).toBe(true);
    expect(matchesSearchFilter(inactive, {})).toBe(false);
  });

  it('includes global values regardless of applicability', () => {
    const g = v({
      valueCode: 'G',
      isGlobal: true,
      applicability: { module: [], category: [], condition: [], country: [] },
    });
    expect(matchesSearchFilter(g, { module: ['X'] })).toBe(true);
  });

  it('OR within field, AND across fields', () => {
    const row = v({
      valueCode: 'R',
      applicability: { module: ['A'], category: ['C'], condition: [], country: ['IN', 'US'] },
    });
    expect(matchesSearchFilter(row, { country: ['IN', 'GB'] })).toBe(true);
    expect(matchesSearchFilter(row, { country: ['DE'] })).toBe(false);
    expect(matchesSearchFilter(row, { module: ['B'], country: ['IN'] })).toBe(false);
    expect(matchesSearchFilter(row, { module: ['A'], country: ['IN'] })).toBe(true);
  });

  it('filters by language with OR within and AND across dimensions', () => {
    const row = v({
      valueCode: 'L',
      applicability: {
        module: ['A'],
        category: [],
        condition: [],
        country: [],
        language: ['EN', 'FR'],
      },
    });
    expect(matchesSearchFilter(row, { language: ['EN'] })).toBe(true);
    expect(matchesSearchFilter(row, { language: ['DE'] })).toBe(false);
    expect(matchesSearchFilter(row, { module: ['B'], language: ['EN'] })).toBe(false);
    expect(matchesSearchFilter(row, { module: ['A'], language: ['FR'] })).toBe(true);
  });

  it('treats missing value language as empty when filter requests language', () => {
    const row = v({
      valueCode: 'N',
      applicability: { module: ['A'], category: [], condition: [], country: [] },
    });
    expect(matchesSearchFilter(row, { language: ['EN'] })).toBe(false);
  });

  it('respects explicit status filter', () => {
    const inactive = v({ valueCode: 'I', status: STATUS.INACTIVE });
    expect(matchesSearchFilter(inactive, { status: STATUS.INACTIVE })).toBe(true);
  });
});

describe('sortValuesForSearch', () => {
  it('sorts by sortOrder then label', () => {
    const a = v({ valueCode: 'A', sortOrder: 2, label: 'b' });
    const b = v({ valueCode: 'B', sortOrder: 1, label: 'z' });
    const c = v({ valueCode: 'C', sortOrder: 1, label: 'a' });
    const out = sortValuesForSearch([a, b, c]).map((x) => x.valueCode);
    expect(out).toEqual(['C', 'B', 'A']);
  });
});
