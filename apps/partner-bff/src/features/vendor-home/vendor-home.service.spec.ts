import { BaseError, ForbiddenError } from '@api-hub/utils';

import type {
  PartnerActor,
  PartnerInternalClient,
  VendorContextSource,
  VendorHomeSummarySource,
} from '../../clients/partner-internal.client';
import { VendorHomeService } from './vendor-home.service';

const now = new Date('2026-11-13T12:00:00+05:30');

const ownerActor: PartnerActor = {
  userId: 'owner-1',
  vendorId: 'vendor-1',
  roles: ['VENDOR'],
  permissions: ['communities:manage'],
  correlationId: 'c-1',
};

const staffActor: PartnerActor = {
  userId: 'staff-1',
  vendorId: 'vendor-1',
  roles: ['BUDDY'],
  permissions: ['visits:view'],
  correlationId: 'c-1',
};

function ownerContext(
  overrides: Partial<VendorContextSource> = {},
): VendorContextSource {
  return {
    hasVendor: true,
    vendorId: 'vendor-1',
    status: 'ACTIVE',
    nextAction: 'OPEN_VENDOR_DASHBOARD',
    membership: {
      role: 'owner',
      permissions: [
        'visits:view',
        'visits:publish',
        'visits:manage',
        'communities:view',
        'communities:manage',
      ],
    },
    detailsAcceptance: { accepted: true, profileRevision: 1 },
    ...overrides,
  };
}

function staffContext(): VendorContextSource {
  return {
    hasVendor: true,
    vendorId: 'vendor-1',
    status: 'ACTIVE',
    nextAction: 'OPEN_VENDOR_DASHBOARD',
    membership: {
      role: 'staff',
      staffId: 'staff-1',
      permissions: ['visits:view'],
    },
  };
}

function homeSummary(): VendorHomeSummarySource {
  return {
    vendorId: 'vendor-1',
    timezone: 'Asia/Kolkata',
    date: '2026-11-13',
    today: {
      visits: {
        total: 4,
        completed: 1,
        inProgress: 1,
        notStarted: 1,
        blocked: 1,
        missed: 0,
        cancelled: 0,
      },
      crew: { assigned: 2, unassigned: 1 },
      completion: { completed: 1, total: 4, percentage: 25 },
      needsAttention: [
        {
          communityId: 'community-1',
          visitWindowId: 'window-1',
          visitCount: 1,
          blockedCount: 1,
          unassignedCount: 0,
        },
      ],
    },
    tomorrow: {
      date: '2026-11-14',
      totalVisits: 2,
      assignedVisits: 1,
      unassignedVisits: 1,
    },
    upcoming: {
      fromDate: '2026-11-14',
      toDate: '2026-11-16',
      days: [
        {
          date: '2026-11-14',
          totalVisits: 2,
          assignedVisits: 1,
          unassignedVisits: 1,
          communities: [{ communityId: 'community-1', visitCount: 1, unassignedCount: 1 }],
        },
      ],
    },
  };
}

function client(overrides: Partial<PartnerInternalClient> = {}): PartnerInternalClient {
  return {
    resolveOperationalAccess: jest.fn(),
    readBooking: jest.fn(),
    readVendor: jest.fn(async () => ({
      vendorContext: ownerContext(),
      sourceAsOf: now.toISOString(),
    })),
    readCapacityCommitments: jest.fn(async () => []),
    readHomeSummary: jest.fn(async () => homeSummary()),
    ...overrides,
  };
}

describe('VendorHomeService', () => {
  it('returns a complete home response for a vendor owner', async () => {
    const stub = client({
      readVendor: jest.fn(async (_actor, query) => {
        if (query.includeVendorContext) {
          return { vendorContext: ownerContext(), sourceAsOf: now.toISOString() };
        }
        if (query.includeProposals) {
          return {
            proposals: [
              {
                proposalId: 'cpr_1',
                communityId: 'community-1',
                quantity: 3,
                status: 'SENT',
                responseDeadline: '2026-11-20T00:00:00.000Z',
                packageScope: { offeringId: 'pkg' },
                serviceWindow: { startDate: '2026-11-21' },
              },
            ],
            sourceAsOf: now.toISOString(),
          };
        }
        return {
          commitments: [
            {
              commitmentId: 'cmt_1',
              communityId: 'community-1',
              quantity: 5,
              reservedSoldQuantity: 1,
              status: 'ACTIVE',
              window: {
                startDate: '2026-11-01',
                endDate: '2026-11-30',
                dailyWindow: { startTime: '09:00', endTime: '13:00' },
              },
              scope: { offeringId: 'pkg' },
              rate: { amountMinor: 1000, currency: 'INR' },
            },
            {
              commitmentId: 'cmt_cancelled',
              communityId: 'community-1',
              quantity: 2,
              reservedSoldQuantity: 0,
              status: 'CANCELLED',
              window: {
                startDate: '2026-10-01',
                endDate: '2026-10-31',
                dailyWindow: { startTime: '09:00', endTime: '13:00' },
              },
            },
          ],
          sourceAsOf: now.toISOString(),
        };
      }),
    });

    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });

    expect(result.vendor).toMatchObject({
      vendorId: 'vendor-1',
      membership: { role: 'owner' },
      nextAction: 'OPEN_VENDOR_DASHBOARD',
    });
    expect(result.home).toMatchObject({
      date: '2026-11-13',
      today: {
        visits: { total: 4, scheduled: 1, blocked: 1 },
        completion: { percentage: 25 },
      },
      tomorrow: {
        totalVisits: 2,
        assignedVisits: 1,
        unassignedVisits: 1,
      },
      upcoming: {
        days: [
          {
            totalVisits: 2,
            assignedVisits: 1,
            unassignedVisits: 1,
            communities: [
              { communityId: 'community-1', visitCount: 1, unassignedCount: 1 },
            ],
          },
        ],
      },
    });
    expect(result.home?.today.needsAttention[0]).not.toHaveProperty('communityName');
    expect(stub.readHomeSummary).toHaveBeenCalledWith(ownerActor, { upcomingDays: 3 });
    expect(result.capacity.pendingProposals).toHaveLength(1);
    expect(result.capacity.pendingProposals[0]).toMatchObject({
      actionable: true,
      isPastDeadline: false,
      status: 'SENT',
    });
    expect(result.capacity.commitments.map((item) => item.commitmentId)).toEqual([
      'cmt_1',
    ]);
    expect(result.meta).toMatchObject({
      partialData: false,
      unavailableSections: [],
      dashboardEligible: true,
    });
    expect(JSON.stringify(result)).not.toContain('idempotencyKey');
    expect(JSON.stringify(result)).not.toContain('GSI1PK');
  });

  it('scopes authorized staff without loading owner-only home summary', async () => {
    const stub = client({
      readVendor: jest.fn(async () => ({
        vendorContext: staffContext(),
        sourceAsOf: now.toISOString(),
      })),
      readHomeSummary: jest.fn(async () => {
        throw new Error('should not be called');
      }),
    });

    const result = await new VendorHomeService(stub, () => now).get(staffActor, {
      upcomingDays: 3,
    });

    expect(result.vendor.membership.role).toBe('staff');
    expect(result.home).toBeNull();
    expect(result.capacity.pendingProposals).toEqual([]);
    expect(result.meta).toMatchObject({
      partialData: true,
      unavailableSections: ['home'],
      dashboardEligible: true,
    });
    expect(stub.readHomeSummary).not.toHaveBeenCalled();
  });

  it('omits operational data when nextAction is not dashboard-eligible', async () => {
    const stub = client({
      readVendor: jest.fn(async () => ({
        vendorContext: ownerContext({ nextAction: 'ACCEPT_VENDOR_DETAILS' }),
        sourceAsOf: now.toISOString(),
      })),
      readHomeSummary: jest.fn(async () => {
        throw new Error('should not be called');
      }),
    });

    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });

    expect(result.home).toBeNull();
    expect(result.capacity).toEqual({ pendingProposals: [], commitments: [] });
    expect(result.meta.dashboardEligible).toBe(false);
    expect(stub.readHomeSummary).not.toHaveBeenCalled();
  });

  it('rejects an overview-shaped homeSummary payload missing today.visits', async () => {
    const stub = client({
      readHomeSummary: jest.fn(async () => ({
        timezone: 'Asia/Kolkata',
        days: [{ date: '2026-11-13', visits: [], progress: {} }],
        issues: [],
        issuesAvailable: true,
        sourceAsOf: now.toISOString(),
      }) as never),
    });

    await expect(
      new VendorHomeService(stub, () => now).get(ownerActor, { upcomingDays: 3 }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'DEPENDENCY_UNAVAILABLE',
      message: expect.stringContaining('today.visits'),
    });
  });

  it('maps SENT proposals as actionable before the deadline', async () => {
    const stub = client({
      readVendor: jest.fn(async (_actor, query) => {
        if (query.includeVendorContext) {
          return { vendorContext: ownerContext(), sourceAsOf: now.toISOString() };
        }
        if (query.includeProposals) {
          return {
            proposals: [
              {
                proposalId: 'cpr_sent',
                communityId: 'community-1',
                quantity: 2,
                status: 'SENT',
                responseDeadline: '2026-11-20T00:00:00.000Z',
              },
            ],
            sourceAsOf: now.toISOString(),
          };
        }
        return { commitments: [], sourceAsOf: now.toISOString() };
      }),
    });
    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });
    expect(result.capacity.pendingProposals[0]).toMatchObject({
      status: 'SENT',
      actionable: true,
      isPastDeadline: false,
    });
  });

  it('maps COUNTERED proposals that still require vendor action', async () => {
    const stub = client({
      readVendor: jest.fn(async (_actor, query) => {
        if (query.includeVendorContext) {
          return { vendorContext: ownerContext(), sourceAsOf: now.toISOString() };
        }
        if (query.includeProposals) {
          return {
            proposals: [
              {
                proposalId: 'cpr_counter',
                communityId: 'community-1',
                quantity: 2,
                status: 'COUNTERED',
                responseDeadline: '2026-11-20T00:00:00.000Z',
                counter: { quantity: 1 },
              },
            ],
            sourceAsOf: now.toISOString(),
          };
        }
        return { commitments: [], sourceAsOf: now.toISOString() };
      }),
    });
    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });
    expect(result.capacity.pendingProposals[0]).toMatchObject({
      status: 'COUNTERED',
      actionable: true,
      counter: { quantity: 1 },
    });
  });

  it('marks expired proposal deadlines as isPastDeadline', async () => {
    const stub = client({
      readVendor: jest.fn(async (_actor, query) => {
        if (query.includeVendorContext) {
          return { vendorContext: ownerContext(), sourceAsOf: now.toISOString() };
        }
        if (query.includeProposals) {
          return {
            proposals: [
              {
                proposalId: 'cpr_late',
                communityId: 'community-1',
                quantity: 2,
                status: 'SENT',
                responseDeadline: '2026-11-01T00:00:00.000Z',
              },
            ],
            sourceAsOf: now.toISOString(),
          };
        }
        return { commitments: [], sourceAsOf: now.toISOString() };
      }),
    });
    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });
    expect(result.capacity.pendingProposals[0]).toMatchObject({
      actionable: false,
      isPastDeadline: true,
    });
  });

  it('includes ACTIVE and CHANGE_PENDING commitments and excludes inactive history', async () => {
    const stub = client({
      readVendor: jest.fn(async (_actor, query) => {
        if (query.includeVendorContext) {
          return { vendorContext: ownerContext(), sourceAsOf: now.toISOString() };
        }
        if (query.includeProposals) {
          return { proposals: [], sourceAsOf: now.toISOString() };
        }
        return {
          commitments: [
            {
              commitmentId: 'active',
              communityId: 'c1',
              quantity: 1,
              reservedSoldQuantity: 0,
              status: 'ACTIVE',
              window: {
                startDate: '2026-11-01',
                endDate: '2026-11-30',
                dailyWindow: { startTime: '09:00', endTime: '13:00' },
              },
            },
            {
              commitmentId: 'pending',
              communityId: 'c1',
              quantity: 1,
              reservedSoldQuantity: 0,
              status: 'CHANGE_PENDING',
              window: {
                startDate: '2026-11-01',
                endDate: '2026-11-30',
                dailyWindow: { startTime: '09:00', endTime: '13:00' },
              },
            },
            {
              commitmentId: 'reduced',
              communityId: 'c1',
              quantity: 1,
              reservedSoldQuantity: 0,
              status: 'REDUCED',
              window: {
                startDate: '2026-11-01',
                endDate: '2026-11-30',
                dailyWindow: { startTime: '09:00', endTime: '13:00' },
              },
            },
          ],
          sourceAsOf: now.toISOString(),
        };
      }),
    });
    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });
    expect(result.capacity.commitments.map((item) => item.status).sort()).toEqual([
      'ACTIVE',
      'CHANGE_PENDING',
    ]);
  });

  it('returns a partial response when proposals fail', async () => {
    const stub = client({
      readVendor: jest.fn(async (_actor, query) => {
        if (query.includeVendorContext) {
          return { vendorContext: ownerContext(), sourceAsOf: now.toISOString() };
        }
        if (query.includeProposals) {
          throw new BaseError('proposals down', 502, 'DEPENDENCY_UNAVAILABLE');
        }
        return {
          commitments: [
            {
              commitmentId: 'cmt_1',
              communityId: 'c1',
              quantity: 1,
              reservedSoldQuantity: 0,
              status: 'ACTIVE',
              window: {
                startDate: '2026-11-01',
                endDate: '2026-11-30',
                dailyWindow: { startTime: '09:00', endTime: '13:00' },
              },
            },
          ],
          sourceAsOf: now.toISOString(),
        };
      }),
    });
    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });
    expect(result.home).not.toBeNull();
    expect(result.capacity.commitments).toHaveLength(1);
    expect(result.meta).toMatchObject({
      partialData: true,
      unavailableSections: ['capacity.pendingProposals'],
    });
  });

  it('returns a partial response when commitments fail', async () => {
    const stub = client({
      readVendor: jest.fn(async (_actor, query) => {
        if (query.includeVendorContext) {
          return { vendorContext: ownerContext(), sourceAsOf: now.toISOString() };
        }
        if (query.includeProposals) {
          return { proposals: [], sourceAsOf: now.toISOString() };
        }
        throw new BaseError('commitments down', 502, 'DEPENDENCY_UNAVAILABLE');
      }),
    });
    const result = await new VendorHomeService(stub, () => now).get(ownerActor, {
      upcomingDays: 3,
    });
    expect(result.home).not.toBeNull();
    expect(result.meta).toMatchObject({
      partialData: true,
      unavailableSections: ['capacity.commitments'],
    });
  });

  it('fails closed when core home summary fails for an eligible owner', async () => {
    const stub = client({
      readHomeSummary: jest.fn(async () => {
        throw new BaseError('booking down', 502, 'DEPENDENCY_UNAVAILABLE');
      }),
    });
    await expect(
      new VendorHomeService(stub, () => now).get(ownerActor, { upcomingDays: 3 }),
    ).rejects.toMatchObject({ statusCode: 502, code: 'DEPENDENCY_UNAVAILABLE' });
  });

   
});
