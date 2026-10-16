import { parseDiscoveryFacts } from './vendor-discovery-facts';

describe('parseDiscoveryFacts', () => {
  it('maps vendor approval, branches, and prices onto catalog state rows', () => {
    const snapshot = parseDiscoveryFacts({
      data: {
        vendorId: 'vendor-1',
        status: 'ACTIVE',
        reviewedAt: '2026-02-01T00:00:00.000Z',
        acceptingWork: true,
        branches: [{
          branchId: 'branch-1',
          operational: true,
          latitude: 12.97,
          longitude: 77.64,
          serviceRadiusKm: 12,
          updatedAt: '2026-02-02T00:00:00.000Z',
        }],
        services: [{
          serviceId: 'svc-1',
          enabled: true,
          priceOverride: 480,
          updatedAt: '2026-03-01T00:00:00.000Z',
        }],
      },
    }, 'vendor-1');

    expect(snapshot.vendor.approved).toBe(true);
    expect(snapshot.vendor.PK).toBe('DISCOVERY_VENDOR#vendor-1');
    expect(snapshot.branches[0]).toEqual(expect.objectContaining({
      branchId: 'branch-1',
      operational: true,
      serviceRadiusKm: 12,
      SK: 'BRANCH#branch-1',
    }));
    expect(snapshot.prices[0]?.priceOverride).toBe(480);
  });

  it('keeps a suspended vendor unapproved', () => {
    const snapshot = parseDiscoveryFacts({
      data: {
        vendorId: 'vendor-1',
        status: 'SUSPENDED',
        reviewedAt: '2026-04-01T00:00:00.000Z',
        acceptingWork: false,
        branches: [],
        services: [],
      },
    }, 'vendor-1');
    expect(snapshot.vendor.approved).toBe(false);
  });

  it('does not retry a missing vendor', () => {
    expect(() => parseDiscoveryFacts({
      error: { statusCode: 404, code: 'VENDOR_NOT_FOUND', message: 'Vendor not found: vendor-1' },
    }, 'vendor-1')).toThrow(expect.objectContaining({
      code: 'VENDOR_NOT_FOUND',
      retryable: false,
    }));
  });
});
