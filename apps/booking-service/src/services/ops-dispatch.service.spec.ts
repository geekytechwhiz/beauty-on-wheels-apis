import { ValidationError } from '@api-hub/utils';

import { OpsDispatchService } from './ops-dispatch.service';

const adminRequest = (query: Record<string, string> = {}) =>
  ({
    query,
    params: query,
    context: {
      userContext: { userId: 'admin-1', roles: ['platform_admin'] },
      authContext: { userId: 'admin-1', identityId: 'admin-1', roles: ['platform_admin'] },
      correlationId: 'corr-1',
    },
  }) as any;

describe('OpsDispatchService', () => {
  const plans = {
    queryOpsSchedule: jest.fn(),
  };
  const service = new OpsDispatchService(plans as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires communityId for demand reads', async () => {
    await expect(
      service.readDemand(
        adminRequest({ fromDate: '2026-11-01', toDate: '2026-11-07' }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns indexed demand totals with 30-minute slot units and completeness metadata', async () => {
    plans.queryOpsSchedule.mockResolvedValue({
      items: [
        {
          record: {
            visitId: 'visit-1',
            planId: 'plan-1',
            vendorId: 'vendor-1',
            communityId: 'community-1',
            visitWindowId: 'morning',
            visitWindowName: 'Morning',
            status: 'SCHEDULED',
            durationMinutes: 45,
            serviceName: 'Exterior wash',
            schedule: { date: '2026-11-01', startTime: '08:00', endTime: '08:45' },
          },
          resumeKey: {},
        },
      ],
      lastEvaluatedKey: undefined,
    });

    const result = await service.readDemand(
      adminRequest({
        communityId: 'community-1',
        fromDate: '2026-11-01',
        toDate: '2026-11-01',
      }),
    );

    expect(result.completeness).toBe('indexedRows');
    expect(result.unit).toMatchObject({ name: 'slotUnit', minutes: 30 });
    expect(result.totals).toMatchObject({
      demandVisits: 1,
      demandSlotUnits: 2,
      scheduled: 1,
    });
    expect(result.byWindow[0]).toMatchObject({
      visitWindowId: 'morning',
      demandSlotUnits: 2,
    });
  });

  it('pages dispatch visits without inventing a population total', async () => {
    plans.queryOpsSchedule.mockResolvedValue({
      items: [
        {
          record: {
            visitId: 'visit-1',
            planId: 'plan-1',
            vendorId: 'vendor-1',
            communityId: 'community-1',
            visitWindowId: 'morning',
            visitWindowName: 'Morning',
            status: 'SCHEDULED',
            durationMinutes: 30,
            serviceName: 'Exterior wash',
            registrationNumber: 'KL07AB1234',
            schedule: { date: '2026-11-03', startTime: '08:00', endTime: '08:30' },
            crewAssignment: { crewId: 'crew-1', assignedAt: '2026-11-02T10:00:00.000Z' },
          },
          resumeKey: { GSI4PK: 'OPS_SCHEDULE#2026-11-03', GSI4SK: 'a' },
        },
      ],
      lastEvaluatedKey: undefined,
    });

    const result = await service.listDispatch(
      adminRequest({ date: '2026-11-03', communityId: 'community-1' }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      visitId: 'visit-1',
      slotUnits: 1,
      assignedCrew: { crewId: 'crew-1' },
    });
    expect(result.pagination).toMatchObject({
      total: null,
      totalAvailability: 'unavailable',
      hasMore: false,
    });
    expect(result.coverage.includesVisitsWrittenBeforeIndex).toBe(false);
  });
});
