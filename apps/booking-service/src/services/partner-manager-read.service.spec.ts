import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { VendorIssuesRepository } from '../repositories/vendor-issues.repository';
import { OperationalAccessGateway } from '../integrations/vendor.client';
import { PackageVisitRecord } from '../types/package-visit.types';
import { VendorIssueRecord } from '../types/vendor-issue.types';
import { PartnerManagerReadService } from './partner-manager-read.service';

const visit: PackageVisitRecord = {
  visitId: 'visit-1', planId: 'plan-1', customerId: 'customer-1', vendorId: 'vendor-1', communityId: 'community-1', visitWindowId: 'window-1',
  serviceId: 'wash', serviceName: 'Wash', sequence: 1, ordinal: 1, status: 'SCHEDULED', durationMinutes: 30,
  schedule: { date: '2026-11-13', startTime: '09:00', timezone: 'Asia/Kolkata', branchId: 'branch-1', durationMinutes: 30 },
  scheduleHistory: [], entitlementConsumed: false, version: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    actor: { userId: 'owner-1', vendorId: 'vendor-1', roles: ['manager'], permissions: [], correlationId: 'c-1' },
    action: 'work',
    query: { date: '2026-11-13', view: 'all', pageSize: 1 },
    ...overrides,
  };
}

describe('PartnerManagerReadService', () => {
  let plans: jest.Mocked<CustomerPlansRepository>;
  let issues: jest.Mocked<VendorIssuesRepository>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let service: PartnerManagerReadService;

  beforeEach(() => {
    plans = {
      listVendorVisitsForDate: jest.fn().mockResolvedValue([visit]),
      getPlan: jest.fn(),
    } as unknown as jest.Mocked<CustomerPlansRepository>;
    issues = { listVendorIssues: jest.fn().mockResolvedValue([{ issueId: 'issue-1', vendorId: 'vendor-1', visitId: 'visit-1', type: 'SAFETY_CONCERN', description: 'Unsafe access', status: 'ACTION_REQUIRED', blocksVisit: true, blockingStartedAt: '2026-11-13T01:00:00.000Z', attachments: [], createdBy: { userId: 'owner-1', role: 'VENDOR_OWNER' }, internalNotes: [], history: [], version: 1, createdAt: '2026-11-13T01:00:00.000Z', updatedAt: '2026-11-13T01:00:00.000Z' }]) } as unknown as jest.Mocked<VendorIssuesRepository>;
    vendors = { getOperationalAccess: jest.fn().mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true }) } as unknown as jest.Mocked<OperationalAccessGateway>;
    service = new PartnerManagerReadService(plans, issues, vendors, () => new Date('2026-11-13T06:30:00.000Z'));
  });

  it('revalidates delegated vendor scope and reads without mutation', async () => {
    const result = await service.read(event()) as { summary: { blocked: number }; items: Array<{ visitId: string }>; issues: Array<{ issueId: string }> };
    expect(result.summary.blocked).toBe(1);
    expect(result.items).toEqual([{ visitId: 'visit-1', planId: 'plan-1', communityId: 'community-1', visitWindowId: 'window-1', date: '2026-11-13', startTime: '09:00', status: 'SCHEDULED', vehicle: {}, service: { serviceId: 'wash', name: 'Wash', estimatedMinutes: 30 } }]);
    expect(result.issues).toEqual([expect.objectContaining({ issueId: 'issue-1', blocksVisit: true, blockingStartedAt: '2026-11-13T01:00:00.000Z' })]);
    expect(vendors.getOperationalAccess).toHaveBeenCalledWith('owner-1');
    expect(Object.keys(plans).some((name) => /^save|^update|^delete/.test(name))).toBe(false);
  });

  it('rejects a delegated actor whose vendor differs from canonical membership', async () => {
    await expect(service.read(event({ actor: { userId: 'owner-1', vendorId: 'vendor-spoofed', roles: ['manager'], permissions: [], correlationId: 'c-1' } })))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects cursors bound to another vendor/filter scope', async () => {
    const cursor = Buffer.from(JSON.stringify({ version: 1, vendorId: 'vendor-other', date: '2026-11-13', mode: 'all', offset: 1 }), 'utf8').toString('base64url');
    await expect(service.read(event({ query: { date: '2026-11-13', view: 'all', cursor } }))).rejects.toMatchObject({ statusCode: 400 });
  });

  describe('active blockers', () => {
    const issue = (overrides: Partial<VendorIssueRecord>): VendorIssueRecord => ({
      issueId: 'issue', vendorId: 'vendor-1', visitId: 'visit-1', type: 'ACCESS_PROBLEM', description: 'Gate closed', status: 'OPEN',
      attachments: [], createdBy: { userId: 'owner-1', role: 'VENDOR_OWNER' }, internalNotes: [], history: [], version: 1,
      createdAt: '2026-11-13T01:00:00.000Z', updatedAt: '2026-11-13T01:00:00.000Z', ...overrides,
    });

    it('counts and projects an open blocker with its start time but keeps a resolved blocker only as history', async () => {
      plans.listVendorVisitsForDate.mockResolvedValue([
        visit,
        { ...visit, visitId: 'visit-2', crewAssignment: { crewId: 'crew-1', assignedAt: '2026-11-12T00:00:00.000Z', assignedBy: 'owner-1' } },
      ]);
      issues.listVendorIssues.mockResolvedValue([
        issue({ issueId: 'open', visitId: 'visit-1', blocksVisit: true, blockingStartedAt: '2026-11-13T02:00:00.000Z' }),
        issue({ issueId: 'resolved', visitId: 'visit-2', status: 'RESOLVED', blocksVisit: true, blockingStartedAt: '2026-11-13T01:30:00.000Z', resolvedAt: '2026-11-13T03:00:00.000Z' }),
      ]);
      const result = await service.read(event({ query: { date: '2026-11-13', view: 'all', pageSize: 50 } })) as WorkResult;
      expect(result.summary).toMatchObject({ blocked: 1, notStarted: 1, unassigned: 0 });
      expect(result.issues).toEqual([
        expect.objectContaining({ issueId: 'open', status: 'OPEN', blocksVisit: true, blockingStartedAt: '2026-11-13T02:00:00.000Z' }),
        expect.not.objectContaining({ blocksVisit: expect.anything() }),
      ]);
      expect(result.issues[1]).toMatchObject({ issueId: 'resolved', status: 'RESOLVED' });
      expect(result.issues[1]).not.toHaveProperty('blockingStartedAt');
      expect(result.crewSummaries).toEqual([{ crewId: 'crew-1', progress: expect.objectContaining({ blocked: 0, notStarted: 1 }) }]);
    });

    it('reports blocked as null rather than zero when issues are unavailable', async () => {
      issues.listVendorIssues.mockRejectedValue(new Error('down'));
      const result = await service.read(event()) as WorkResult;
      expect(result.issuesAvailable).toBe(false);
      expect(result.summary.blocked).toBeNull();
    });
  });

  describe('visit projection', () => {
    const at = '2026-11-13T04:00:00.000Z';
    const project = async (overrides: Partial<PackageVisitRecord>) => {
      plans.listVendorVisitsForDate.mockResolvedValue([{ ...visit, ...overrides }]);
      return ((await service.read(event())) as WorkResult).items[0];
    };

    it.each([
      ['IN_PROGRESS', { startedAt: at }],
      ['COMPLETED', { startedAt: '2026-11-13T03:00:00.000Z', completedAt: at }],
      ['MISSED', { missedAt: at }],
      ['CANCELLED', { cancelledAt: at }],
    ] as const)('uses the %s transition timestamp as statusAt', async (status, timestamps) => {
      expect(await project({ status, ...timestamps })).toMatchObject({ status, statusAt: at });
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'MISSED', 'CANCELLED'] as const)('omits statusAt for %s when the timestamp is absent', async (status) => {
      expect(await project({ status })).not.toHaveProperty('statusAt');
    });

    it('uses the latest schedule transition for SCHEDULED and omits it without history', async () => {
      const scheduled = await project({
        scheduleHistory: [
          { at: '2026-11-10T00:00:00.000Z', action: 'scheduled', by: 'staff-1' },
          { at: '2026-11-11T00:00:00.000Z', action: 'rescheduled', by: 'staff-1' },
        ],
      });
      expect(scheduled.statusAt).toBe('2026-11-11T00:00:00.000Z');
      expect(await project({ scheduleHistory: [] })).not.toHaveProperty('statusAt');
      expect(await project({ scheduleHistory: undefined as unknown as [] })).not.toHaveProperty('statusAt');
    });

    it('copies reviewStatus from validationStatus and omits unknown or absent values', async () => {
      expect(await project({ status: 'COMPLETED', completedAt: at, validationStatus: 'PENDING_REVIEW' })).toMatchObject({ reviewStatus: 'PENDING_REVIEW' });
      expect(await project({ status: 'COMPLETED', completedAt: at, validationStatus: 'REJECTED' })).toMatchObject({ reviewStatus: 'REJECTED' });
      expect(await project({ status: 'COMPLETED', completedAt: at })).not.toHaveProperty('reviewStatus');
      expect(await project({ status: 'COMPLETED', completedAt: at, validationStatus: 'BOGUS' as never })).not.toHaveProperty('reviewStatus');
    });

    it('projects parkingBay when present and omits it otherwise', async () => {
      expect(await project({ parkingBay: 'B2-14' })).toMatchObject({ parkingBay: 'B2-14' });
      expect(await project({})).not.toHaveProperty('parkingBay');
      expect(await project({ parkingBay: '  ' })).not.toHaveProperty('parkingBay');
    });
  });

  describe('pagination', () => {
    const at = (time: string, id: string, overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord => ({
      ...visit, visitId: id, schedule: { ...visit.schedule!, startTime: time }, ...overrides,
    });

    async function walk(query: Record<string, unknown>, between: (page: number) => void = () => undefined) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let page = 0;
      do {
        const result = await service.read(event({ query: { date: '2026-11-13', pageSize: 1, ...query, ...(cursor ? { cursor } : {}) } })) as WorkResult;
        seen.push(...result.items.map((item) => item.visitId));
        cursor = result.nextCursor ?? undefined;
        between(++page);
      } while (cursor && page < 20);
      return seen;
    }

    it('summarises the whole filtered day regardless of page size and reports the view total', async () => {
      plans.listVendorVisitsForDate.mockResolvedValue([
        at('09:00', 'a'), at('10:00', 'b', { status: 'COMPLETED', completedAt: '2026-11-13T05:00:00.000Z' }), at('11:00', 'c'),
      ]);
      const result = await service.read(event({ query: { date: '2026-11-13', view: 'active', pageSize: 1 } })) as WorkResult;
      expect(result.items.map((item) => item.visitId)).toEqual(['a']);
      expect(result.summary).toMatchObject({ expected: 3, completed: 1, unassigned: 2 });
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    it('neither duplicates nor skips visits when statuses change and visits are rescheduled mid-walk', async () => {
      let rows = [at('09:00', 'a'), at('10:00', 'b'), at('11:00', 'c'), at('12:00', 'd')];
      plans.listVendorVisitsForDate.mockImplementation(async () => rows);
      let clock = Date.parse('2026-11-13T06:30:00.000Z');
      service = new PartnerManagerReadService(plans, issues, vendors, () => new Date(clock));
      const seen = await walk({ view: 'active' }, (page) => {
        clock += 60_000;
        const now = new Date(clock).toISOString();
        if (page === 1) {
          // `a` was returned; move it after the cursor. Offset paging would show it twice.
          rows = rows.map((row) => row.visitId === 'a'
            ? { ...row, schedule: { ...row.schedule!, startTime: '13:00' }, updatedAt: now,
              scheduleHistory: [{ at: now, action: 'rescheduled', by: 'owner-1', from: { date: '2026-11-13', startTime: '09:00' }, to: { date: '2026-11-13', startTime: '13:00' } }] }
            : row);
        }
        if (page === 2) {
          // `c` completes before it is reached, and a new visit lands before the cursor.
          rows = [
            ...rows.map((row) => row.visitId === 'c' ? { ...row, status: 'COMPLETED' as const, startedAt: now, completedAt: now, updatedAt: now } : row),
            at('08:00', 'late-arrival', { updatedAt: now, scheduleHistory: [{ at: now, action: 'scheduled', by: 'owner-1', to: { date: '2026-11-13', startTime: '08:00' } }] }),
          ];
        }
      });
      expect(seen).toEqual(['a', 'b', 'c', 'd']);
    });

    it('starts a fresh walk at the current state', async () => {
      plans.listVendorVisitsForDate.mockResolvedValue([at('09:00', 'a'), at('10:00', 'b')]);
      expect(await walk({ view: 'all' })).toEqual(['a', 'b']);
    });

    it('continues a legacy offset cursor and then issues a keyset cursor', async () => {
      plans.listVendorVisitsForDate.mockResolvedValue([at('09:00', 'a'), at('10:00', 'b'), at('11:00', 'c')]);
      const legacy = Buffer.from(JSON.stringify({ version: 1, vendorId: 'vendor-1', date: '2026-11-13', mode: 'all', offset: 1 }), 'utf8').toString('base64url');
      const result = await service.read(event({ query: { date: '2026-11-13', view: 'all', pageSize: 1, cursor: legacy } })) as WorkResult;
      expect(result.items.map((item) => item.visitId)).toEqual(['b']);
      expect(JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8'))).toMatchObject({ version: 2, after: { startTime: '10:00', visitId: 'b' } });
    });

    it('rejects tampered keyset cursors', async () => {
      const future = Buffer.from(JSON.stringify({ version: 2, vendorId: 'vendor-1', date: '2026-11-13', mode: 'all', asOf: '2027-01-01T00:00:00.000Z', after: { startTime: '09:00', visitId: 'a' } }), 'utf8').toString('base64url');
      await expect(service.read(event({ query: { date: '2026-11-13', view: 'all', cursor: future } }))).rejects.toMatchObject({ statusCode: 400 });
      const otherView = Buffer.from(JSON.stringify({ version: 2, vendorId: 'vendor-1', date: '2026-11-13', mode: 'completed', asOf: '2026-11-13T06:00:00.000Z', after: { startTime: '09:00', visitId: 'a' } }), 'utf8').toString('base64url');
      await expect(service.read(event({ query: { date: '2026-11-13', view: 'all', cursor: otherView } }))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('keeps the explicit 1,500-visit safety limit', async () => {
      plans.listVendorVisitsForDate.mockResolvedValue(Array.from({ length: 1_501 }, (_, index) => at('09:00', `v-${index}`)));
      await expect(service.read(event())).rejects.toMatchObject({ statusCode: 409, code: 'SUMMARY_TOO_LARGE' });
    });

    it('rejects a page size above 50', async () => {
      await expect(service.read(event({ query: { date: '2026-11-13', pageSize: 51 } }))).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});

interface WorkResult {
  summary: { blocked: number | null; [key: string]: unknown };
  crewSummaries: Array<{ crewId: string; progress: Record<string, unknown> }>;
  items: Array<Record<string, unknown> & { visitId: string; statusAt?: string }>;
  issues: Array<Record<string, unknown>>;
  issuesAvailable: boolean;
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}
