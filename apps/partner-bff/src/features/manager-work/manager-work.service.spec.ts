import { BaseError } from '@api-hub/utils';

import type { ManagerWorkPage, PartnerActor, PartnerInternalClient, SchedulingCrew, VendorManagerData } from '../../clients/partner-internal.client';
import { ManagerWorkService, parseManagerWorkQuery } from './manager-work.service';

const actor: PartnerActor = { userId: 'user-1', vendorId: 'vendor-1', roles: ['manager'], permissions: [], correlationId: 'c-1' };
const sourceAsOf = '2026-11-13T06:30:00.000Z';

const page: ManagerWorkPage = {
  timezone: 'Asia/Kolkata', date: '2026-11-13', sourceAsOf, nextCursor: 'next', hasMore: true, issuesAvailable: true,
  summary: { expected: 2, completed: 1, inProgress: 0, notStarted: 0, blocked: 1, unassigned: 0, missed: 0, cancelled: 0 },
  issues: [{ issueId: 'issue-1', visitId: 'visit-1', type: 'SAFETY_CONCERN', status: 'ACTION_REQUIRED', createdAt: sourceAsOf, updatedAt: sourceAsOf, blocksVisit: true }],
  items: [
    { visitId: 'visit-1', planId: 'plan-1', communityId: 'community-1', date: '2026-11-13', status: 'SCHEDULED', crewId: 'crew-1', service: { serviceId: 'service', name: 'Wash', estimatedMinutes: 30 } },
    { visitId: 'visit-2', planId: 'plan-2', communityId: 'community-1', date: '2026-11-13', status: 'COMPLETED', crewId: 'crew-1', service: { serviceId: 'service', name: 'Wash', estimatedMinutes: 30 } },
  ],
};

const crew: SchedulingCrew = {
  crewId: 'crew-1', vendorId: 'vendor-1', name: 'Crew One', vanLabel: 'Van One', status: 'ACTIVE',
  availabilityStatus: 'AVAILABLE', capacityPerDay: 4,
  staff: [{ staffId: 'staff-1', name: 'Asha', status: 'ACTIVE' }, { staffId: 'staff-2', name: 'Ravi', status: 'ACTIVE' }],
};

function clientWith(work: ManagerWorkPage, crews: () => Promise<VendorManagerData>): PartnerInternalClient {
  return {
    resolveOperationalAccess: jest.fn(),
    readBooking: jest.fn(async () => work),
    readVendor: jest.fn(async (_actor, query) => query.communityIds
      ? { communities: [{ communityId: 'community-1', name: 'Green Acres' }], sourceAsOf }
      : crews()),
    readCapacityCommitments: jest.fn(async () => []),
  };
}

async function read(work: ManagerWorkPage = page, crews: () => Promise<VendorManagerData> = async () => ({ crews: [crew], sourceAsOf })) {
  const query = parseManagerWorkQuery({ date: '2026-11-13', view: 'all', pageSize: '20' }, new Date(sourceAsOf));
  return new ManagerWorkService(clientWith(work, crews), () => new Date(sourceAsOf)).get(actor, query);
}

describe('ManagerWorkService', () => {
  it('keeps the filter-scope summary separate from the paginated tab list and joins explicit blockers', async () => {
    const query = parseManagerWorkQuery({ date: '2026-11-13', view: 'active', pageSize: '2' }, new Date(sourceAsOf));
    const result = await new ManagerWorkService(clientWith(page, async () => ({ crews: [crew], sourceAsOf })), () => new Date(sourceAsOf)).get(actor, query);
    expect(result.data.summary).toEqual(page.summary);
    expect(result.pagination).toEqual({ nextCursor: 'next', hasMore: true, total: null, totalAvailability: 'unavailable' });
    expect(result.data.groups[0].visits[0]).toMatchObject({ visitId: 'visit-1', blockers: [{ issueId: 'issue-1' }] });
  });

  it('validates the tab and page size', () => {
    expect(() => parseManagerWorkQuery({ view: 'unknown' }, new Date(sourceAsOf))).toThrow('view must be all, active, or completed');
    expect(() => parseManagerWorkQuery({ pageSize: '51' }, new Date(sourceAsOf))).toThrow('pageSize must be an integer from 1 to 50');
    expect(() => parseManagerWorkQuery({ date: '2026-02-31' }, new Date(sourceAsOf))).toThrow('date must be YYYY-MM-DD');
    expect(() => parseManagerWorkQuery({ cursor: 'x'.repeat(4097) }, new Date(sourceAsOf))).toThrow('cursor is too long');
  });

  describe('crews', () => {
    it('marks crews available and joins roster data when Vendor is healthy', async () => {
      const result = await read();
      expect(result.sections.crews).toEqual({ available: true, sourceAsOf });
      expect(result.freshness.vendor).toBe(sourceAsOf);
      expect(result.data.groups[0].crew).toMatchObject({
        crewId: 'crew-1',
        displayName: 'Crew One',
        vanLabel: 'Van One',
        members: [{ staffId: 'staff-1', displayName: 'Asha', status: 'ACTIVE' }, { staffId: 'staff-2', displayName: 'Ravi', status: 'ACTIVE' }],
      });
    });

    it('falls back to unavailable crews without failing the work response when Vendor is down', async () => {
      const result = await read(page, async () => { throw new BaseError('Vendor manager data is unavailable', 502, 'DEPENDENCY_UNAVAILABLE'); });
      expect(result.sections.crews).toEqual({ available: false, reason: 'DEPENDENCY_UNAVAILABLE' });
      expect(result.sections.work).toEqual({ available: true, sourceAsOf });
      expect(result.freshness).not.toHaveProperty('vendor');
      expect(result.data.groups[0].crew).toEqual({
        crewId: 'crew-1', pointOfContact: { status: 'UNAVAILABLE', reason: 'NOT_SUPPORTED' }, members: [],
      });
    });

    it('forwards the Vendor point of contact', async () => {
      const result = await read(page, async () => ({
        crews: [{ ...crew, pointOfContact: { staffId: 'staff-2', name: 'Ravi', phoneNumber: '+919811111111', source: 'designated' } }],
        sourceAsOf,
      }));
      expect((result.data.groups[0].crew as Record<string, unknown>).pointOfContact).toEqual({
        status: 'AVAILABLE', staffId: 'staff-2', displayName: 'Ravi', phoneNumber: '+919811111111', source: 'designated',
      });
    });

    it('keeps the existing unavailable contact when Vendor cannot determine one', async () => {
      const result = await read();
      expect((result.data.groups[0].crew as Record<string, unknown>).pointOfContact).toEqual({ status: 'UNAVAILABLE', reason: 'NOT_SUPPORTED' });
    });
  });

  describe('blockers', () => {
    const work: ManagerWorkPage = {
      ...page,
      items: [
        page.items[0],
        { visitId: 'visit-3', planId: 'plan-3', date: '2026-11-13', status: 'SCHEDULED', service: { serviceId: 'service', name: 'Wash', estimatedMinutes: 30 } },
      ],
      issues: [
        { issueId: 'open', visitId: 'visit-1', type: 'ACCESS_PROBLEM', status: 'OPEN', createdAt: sourceAsOf, updatedAt: sourceAsOf, blocksVisit: true, blockingStartedAt: '2026-11-13T05:00:00.000Z' },
        { issueId: 'unassigned-open', visitId: 'visit-3', type: 'SAFETY_CONCERN', status: 'TRIAGED', createdAt: sourceAsOf, updatedAt: sourceAsOf, blocksVisit: true, blockingStartedAt: '2026-11-13T05:30:00.000Z' },
        // An older Booking deployment may still project blocksVisit on a resolved issue.
        { issueId: 'resolved', visitId: 'visit-1', type: 'ACCESS_PROBLEM', status: 'RESOLVED', createdAt: sourceAsOf, updatedAt: sourceAsOf, blocksVisit: true, blockingStartedAt: '2026-11-13T04:00:00.000Z' },
        { issueId: 'informational', visitId: 'visit-3', type: 'OTHER', status: 'OPEN', createdAt: sourceAsOf, updatedAt: sourceAsOf },
      ],
    };

    it('returns only active blockers with their start time in groups and unassigned', async () => {
      const result = await read(work);
      expect(result.data.groups[0].visits).toEqual([expect.objectContaining({
        visitId: 'visit-1',
        blockers: [{ issueId: 'open', type: 'ACCESS_PROBLEM', status: 'OPEN', blockingStartedAt: '2026-11-13T05:00:00.000Z' }],
      })]);
      expect(result.data.unassigned).toEqual([expect.objectContaining({
        visitId: 'visit-3',
        blockers: [{ issueId: 'unassigned-open', type: 'SAFETY_CONCERN', status: 'TRIAGED', blockingStartedAt: '2026-11-13T05:30:00.000Z' }],
      })]);
    });

    it('omits blockingStartedAt for legacy blockers that never recorded it', async () => {
      const result = await read({ ...page, issues: [{ ...page.issues[0] }] });
      expect((result.data.groups[0].visits as Array<Record<string, unknown>>)[0].blockers).toEqual([{ issueId: 'issue-1', type: 'SAFETY_CONCERN', status: 'ACTION_REQUIRED' }]);
    });

    it('reports blockers as unavailable when the issue dependency failed', async () => {
      const result = await read({ ...page, issuesAvailable: false, issues: [] });
      expect(result.sections.blockers).toEqual({ available: false, reason: 'DEPENDENCY_UNAVAILABLE' });
      expect((result.data.groups[0].visits as Array<Record<string, unknown>>)[0].blockers).toEqual({ status: 'UNAVAILABLE', reason: 'DEPENDENCY_UNAVAILABLE' });
    });
  });

  describe('visit fields', () => {
    it('forwards statusAt, reviewStatus, and parkingBay when Booking supplies them', async () => {
      const result = await read({
        ...page,
        items: [{ ...page.items[1], statusAt: '2026-11-13T05:45:00.000Z', reviewStatus: 'PENDING_REVIEW', parkingBay: 'B2-14' }],
      });
      expect(result.data.groups[0].visits[0]).toMatchObject({ statusAt: '2026-11-13T05:45:00.000Z', reviewStatus: 'PENDING_REVIEW', parkingBay: 'B2-14' });
    });

    it('omits them when Booking does not', async () => {
      const visit = (await read()).data.groups[0].visits[0];
      expect(visit).not.toHaveProperty('statusAt');
      expect(visit).not.toHaveProperty('reviewStatus');
      expect(visit).not.toHaveProperty('parkingBay');
    });
  });

  describe('whole-day totals', () => {
    it('exposes the view total and per-crew day progress without changing page-scoped progress', async () => {
      const dayProgress = { expected: 12, completed: 5, inProgress: 1, notStarted: 6, blocked: 0, unassigned: 0, missed: 0, cancelled: 0 };
      const result = await read({ ...page, total: 37, crewSummaries: [{ crewId: 'crew-1', progress: dayProgress }] });
      expect(result.pagination).toEqual({ nextCursor: 'next', hasMore: true, total: 37, totalAvailability: 'available' });
      expect(result.data.groups[0]).toMatchObject({
        progress: { completed: 1, inProgress: 0, notStarted: 1, missed: 0, cancelled: 0 },
        dayProgress,
      });
    });

    it('omits dayProgress when Booking does not supply crew summaries', async () => {
      expect((await read()).data.groups[0]).not.toHaveProperty('dayProgress');
    });
  });
});
