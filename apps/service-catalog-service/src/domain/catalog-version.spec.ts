import { nextCatalogVersion } from './catalog-version';

describe('nextCatalogVersion', () => {
  it('initializes a legacy record to 1 until an input changes', () => {
    expect(nextCatalogVersion(undefined, false)).toBe(1);
    expect(nextCatalogVersion(undefined, true)).toBe(2);
  });

  it('increments an authoritative version only when the caller marks a change', () => {
    expect(nextCatalogVersion(4, false)).toBe(4);
    expect(nextCatalogVersion(4, true)).toBe(5);
  });
});
