import type { ManagerPlanningPage, PartnerActor, PartnerInternalClient, VendorManagerData } from '../../clients/partner-internal.client';
import { ManagerPlanningService, parseManagerPlanningQuery } from './manager-planning.service';

const actor: PartnerActor = { userId: 'user-1', vendorId: 'vendor-1', roles: ['manager'], permissions: [], correlationId: 'c-1' };
const sourceAsOf = '2026-11-13T06:30:00.000Z';

const planning: ManagerPlanningPage = {
  timezone: 'Asia/Kolkata', date: '2026-11-14', tab: 'availability', sourceAsOf, nextCursor: null, hasMore: false,
  counts: { scheduled: 3, assigned: 2, unassigned: 1 },
  summary: { expected: 3, completed: 0, inProgress: 0, notStarted: 2, blocked: 0, unassigned: 1, missed: 0, cancelled: 0 },
  items: [],
};

const client: PartnerInternalClient = {
  resolveOperationalAccess: jest.fn(),
  readBooking: jest.fn(async () => planning),
  readVendor: jest.fn(async () => ({
    crews: [{ crewId: 'crew-1', vendorId: 'vendor-1', name: 'Crew One', vanLabel: 'Van One', status: 'ACTIVE', staff: [{ staffId: 'staff-1', name: 'Ravi', status: 'ACTIVE' }] }],
    commitments: [{ commitmentId: 'commitment-1', communityId: 'community-1', quantity: 4, reservedSoldQuantity: 0, status: 'ACCEPTED', window: { startDate: '2026-11-14', endDate: '2026-11-14', dailyWindow: { startTime: '09:00', endTime: '18:00' } } }],
    sourceAsOf,
  } as VendorManagerData)),
};

describe('ManagerPlanningService', () => {
  it('returns only the availability tab and does not fabricate dated confirmation or capacity', async () => {
    const query = parseManagerPlanningQuery({ date: '2026-11-14', tab: 'availability', pageSize: '10' }, new Date(sourceAsOf));
    const result = await new ManagerPlanningService(client, () => new Date(sourceAsOf)).get(actor, query);
    expect(result.data).toMatchObject({ counts: { scheduled: 3, assigned: 2, unassigned: 1 }, tab: 'availability' });
    expect(result.data.items).toEqual([expect.objectContaining({ crewId: 'crew-1', datedAvailabilityConfirmation: { status: 'UNAVAILABLE', reason: 'DATED_CONFIRMATION_NOT_SUPPORTED' } })]);
    expect(result.data.capacity).toMatchObject({ acceptedCommitmentCapacity: 4, configuredCapacity: { status: 'UNAVAILABLE' }, effectiveOperationalCapacity: { status: 'UNAVAILABLE' } });
  });

  it('validates tab filters', () => {
    expect(() => parseManagerPlanningQuery({ tab: 'all' }, new Date(sourceAsOf))).toThrow('tab must be unassigned, assigned, or availability');
  });

  it('preserves the required planning result when optional vendor display data fails', async () => {
    const unavailable: PartnerInternalClient = { ...client, readVendor: jest.fn(async () => { throw new Error('Vendor unavailable'); }) };
    const query = parseManagerPlanningQuery({ date: '2026-11-14', tab: 'availability' }, new Date(sourceAsOf));
    const result = await new ManagerPlanningService(unavailable, () => new Date(sourceAsOf)).get(actor, query);
    expect(result.sections).toMatchObject({ planning: { available: true }, crews: { available: false }, capacity: { available: false } });
    expect(result.data.capacity).toMatchObject({ acceptedCommitmentCapacity: null, configuredCapacity: { reason: 'DEPENDENCY_UNAVAILABLE' } });
  });
});
