import {
  nextOfferingVersion,
  revisionsMatch,
  type OfferingRevision,
} from './offering-revision';

const current: OfferingRevision = {
  offeringId: 'svc-1',
  vendorId: 'vendor-1',
  offeringVersion: 4,
  catalogVersion: 2,
  vendorPricingVersion: 3,
  dependencyVersions: [],
};

describe('offering revision', () => {
  it('matches only when every pricing input version is unchanged', () => {
    expect(revisionsMatch(current, {
      offeringId: 'svc-1',
      vendorId: 'vendor-1',
      catalogVersion: 2,
      vendorPricingVersion: 3,
      dependencyVersions: [],
    })).toBe(true);
    expect(revisionsMatch(current, {
      ...current,
      catalogVersion: 3,
    })).toBe(false);
    expect(revisionsMatch(current, {
      ...current,
      vendorPricingVersion: 4,
    })).toBe(false);
  });

  it('assigns the next revision from the stored offering version', () => {
    expect(nextOfferingVersion(null)).toBe(1);
    expect(nextOfferingVersion(current)).toBe(5);
  });
});
