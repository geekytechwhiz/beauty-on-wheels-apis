import { normalizeShareScope, normalizeShareScopeOrThrow } from './share-scope.utils';

describe('share-scope.utils', () => {
  it('normalizes product labels', () => {
    expect(normalizeShareScope('private')).toBe('PRIVATE');
    expect(normalizeShareScope('Organization')).toBe('ORGANIZATION');
    expect(normalizeShareScope('PUBLIC')).toBe('PUBLIC');
  });

  it('maps legacy shareScope when reading stored data', () => {
    expect(normalizeShareScope('shareable')).toBe('PUBLIC');
    expect(normalizeShareScope('ORG')).toBe('ORGANIZATION');
  });

  it('rejects invalid shareScope on API write', () => {
    expect(() => normalizeShareScopeOrThrow('shareable')).toThrow(/Private, Organization, Public/);
  });
});
