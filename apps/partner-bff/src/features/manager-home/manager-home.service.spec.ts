import type { ManagerOverview, PartnerActor, PartnerInternalClient, VendorManagerData } from '../../clients/partner-internal.client';
import { ManagerHomeService } from './manager-home.service';

const actor: PartnerActor = { userId: 'user-1', vendorId: 'vendor-1', roles: ['manager'], permissions: [], correlationId: 'c-1' };
const now = new Date('2026-11-13T12:00:00+05:30');

function overview(issuesAvailable = true): ManagerOverview {
  return {
    timezone: 'Asia/Kolkata', sourceAsOf: now.toISOString(), issuesAvailable,
    issues: issuesAvailable ? [{ issueId: 'issue-1', visitId: 'visit-1', type: 'SAFETY_CONCERN', status: 'ACTION_REQUIRED', createdAt: '2026-11-13T04:00:00.000Z', updatedAt: '2026-11-13T04:00:00.000Z', blocksVisit: true }] : [],
    days: ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map((date) => ({
      date,
      visits: date === '2026-11-13' ? [{ visitId: 'visit-1', planId: 'plan-1', communityId: 'community-1', visitWindowId: 'window-1', visitWindowName: 'Morning', window: { endTime: '11:00' }, date, status: 'SCHEDULED' as const, crewId: 'crew-1', service: { serviceId: 'service-1', name: 'Wash', estimatedMinutes: 30 } }] : [],
      progress: { expected: date === '2026-11-13' ? 1 : 0, completed: 0, inProgress: 0, notStarted: date === '2026-11-13' ? 0 : 0, blocked: issuesAvailable ? (date === '2026-11-13' ? 1 : 0) : null, unassigned: 0, missed: 0, cancelled: 0 },
    })),
  };
}

function client(issueAvailable = true): PartnerInternalClient {
  return {
    resolveOperationalAccess: jest.fn(),
    readBooking: jest.fn(async () => overview(issueAvailable)),
    readVendor: jest.fn(async (_actor, query) => {
      if (query.communityIds) return { communities: [{ communityId: 'community-1', name: 'Green Acres' }], sourceAsOf: now.toISOString() } as VendorManagerData;
      return { crews: [{ crewId: 'crew-1', vendorId: 'vendor-1', name: 'North Crew', vanLabel: 'Van 1', status: 'ACTIVE', availabilityStatus: 'AVAILABLE', capacityPerDay: 4, staff: [{ staffId: 'staff-1', name: 'Ravi', status: 'ACTIVE' }, { staffId: 'staff-2', name: 'Asha', status: 'ACTIVE' }] }], commitments: [], sourceAsOf: now.toISOString() } as VendorManagerData;
    }),
    readCapacityCommitments: jest.fn(async () => []),
    readHomeSummary: jest.fn(),
  };
}

describe('ManagerHomeService', () => {
  it('uses only explicit blocks for the next action and reports missing block-start data honestly', async () => {
    const result = await new ManagerHomeService(client(), () => now).get(actor);
    expect(result.data.nextAction).toMatchObject({ kind: 'ISSUE_ACTION_REQUIRED', blocking: true, affectedVisitCount: 1, blockingStart: { status: 'UNAVAILABLE' } });
    expect(result.data.todayProgress).toMatchObject({ progress: { blocked: 1 } });
    expect(result.data.todayProgress.windows[0].visitWindow.remainingMinutes).toBe(0);
  });

  it('exposes the issue raise time without treating it as the blocking start', async () => {
    const result = await new ManagerHomeService(client(), () => now).get(actor);
    expect(result.data.nextAction).toMatchObject({
      issue: { issueId: 'issue-1', createdAt: '2026-11-13T04:00:00.000Z' },
      community: { communityId: 'community-1', displayName: 'Green Acres' },
      crew: { crewId: 'crew-1', displayName: 'North Crew' },
    });
  });

  it('uses the backend blocker timestamp and computes dated crew availability from capacity and workload', async () => {
    const source = overview();
    source.issues[0] = { ...source.issues[0]!, blockingStartedAt: '2026-11-13T05:00:00.000Z' };
    source.days[1]!?.visits = [{
      ...source.days[0]!?.visits[0]!,
      visitId: 'visit-2',
      date: '2026-11-14',
      service: { serviceId: 'service-1', name: 'Wash', estimatedMinutes: 60 },
    }];
    const stub = client();
    (stub.readBooking as jest.Mock).mockResolvedValue(source);
    const result = await new ManagerHomeService(stub, () => now).get(actor);
    expect(result.data.nextAction).toMatchObject({
      blockingStart: { status: 'AVAILABLE', at: '2026-11-13T05:00:00.000Z' },
    });
    const upcoming = result.data.upcomingPlan as { groups: Array<{ crews: Array<Record<string, unknown>> }> };
    expect(upcoming.groups[0]!.crews[0]).toMatchObject({
      availabilityConfirmation: {
        status: 'UNAVAILABLE',
        reason: 'DATED_CONFIRMATION_NOT_SUPPORTED',
      },
      availability: { status: 'AVAILABLE' },
      capacity: {
        capacityPerDay: 4,
        assignedCapacityUnits: 2,
        availableCapacityUnits: 2,
        capacityUnit: 'THIRTY_MINUTE_SLOT',
      },
    });
    expect(result.appliedFilters).toEqual({
      date: '2026-11-13',
      fromDate: '2026-11-13',
      toDate: '2026-11-16',
    });
    expect(result.data.communityLabels).toEqual([
      { communityId: 'community-1', displayName: 'Green Acres' },
    ]);
  });

  it('does not surface a resolved blocker as the next action', async () => {
    const source = overview();
    source.issues = [{ ...source.issues[0]!, status: 'RESOLVED' }];
    const stub = client();
    (stub.readBooking as jest.Mock).mockResolvedValue(source);
    const result = await new ManagerHomeService(stub, () => now).get(actor);
    expect(result.data.nextAction).toBeNull();
  });

  it('counts open visits in the community for a community-level blocking issue', async () => {
    const source = overview();
    const today = source.days[0]!;
    const visit = today?.visits[0]!;
    today?.visits = [
      visit,
      { ...visit, visitId: 'visit-2', status: 'IN_PROGRESS' },
      { ...visit, visitId: 'visit-3', status: 'COMPLETED' },
      { ...visit, visitId: 'visit-4', communityId: 'community-2' },
    ];
    source.issues = [{ ...source.issues[0]!, visitId: undefined, communityId: 'community-1' }];
    const stub = client();
    (stub.readBooking as jest.Mock).mockResolvedValue(source);
    const result = await new ManagerHomeService(stub, () => now).get(actor);
    expect(result.data.nextAction).toMatchObject({ affectedVisitCount: 2, community: { communityId: 'community-1' } });
  });

  it('returns window times and the current window aggregated across communities', async () => {
    const source = overview();
    const today = source.days[0]!;
    const visit = { ...today?.visits[0]!, window: { startTime: '11:00', endTime: '14:00' } };
    today?.visits = [
      visit,
      { ...visit, visitId: 'visit-2', communityId: 'community-2', status: 'IN_PROGRESS' as const },
      { ...visit, visitId: 'visit-3', status: 'COMPLETED' as const },
      { ...visit, visitId: 'visit-4', visitWindowId: 'window-2', visitWindowName: 'Evening', window: { startTime: '16:00', endTime: '19:00' } },
    ];
    const stub = client();
    (stub.readBooking as jest.Mock).mockResolvedValue(source);
    const result = await new ManagerHomeService(stub, () => now).get(actor);
    const progress = result.data.todayProgress as { windows: Array<Record<string, unknown>>; currentWindow: unknown };
    expect(progress.windows[0]).toMatchObject({
      visitWindow: { visitWindowId: 'window-1', startTime: '11:00', endTime: '14:00', remainingMinutes: 120 },
      remaining: 1,
    });
    expect(progress.currentWindow).toEqual({
      visitWindowId: 'window-1',
      displayName: 'Morning',
      startTime: '11:00',
      endTime: '14:00',
      state: 'ACTIVE',
      remainingVisits: 2,
      remainingMinutes: 120,
    });
  });

  it('reports the next window as upcoming when none is in progress', async () => {
    const source = overview();
    const today = source.days[0]!;
    today?.visits = [{ ...today?.visits[0]!, window: { startTime: '16:00', endTime: '19:00' } }];
    const stub = client();
    (stub.readBooking as jest.Mock).mockResolvedValue(source);
    const result = await new ManagerHomeService(stub, () => now).get(actor);
    expect(result.data.todayProgress).toMatchObject({
      currentWindow: { visitWindowId: 'window-1', state: 'UPCOMING', minutesUntilStart: 240, remainingVisits: 1 },
    });
  });

  it('marks next-action and blocker counts unavailable when the optional issue dependency fails', async () => {
    const result = await new ManagerHomeService(client(false), () => now).get(actor);
    expect(result.sections.nextAction).toMatchObject({ available: false, reason: 'DEPENDENCY_UNAVAILABLE' });
    expect(result.data.nextAction).toBeNull();
    expect(result.data.todayProgress).toMatchObject({ progress: { blocked: null }, issueData: { available: false } });
  });
});
