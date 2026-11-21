import { buildRequestContext } from '@api-hub/middleware';

import { OperationalAccessGateway } from '../integrations/vendor.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { PackageVisitRecord } from '../types/package-visit.types';
import { VendorPackageVisitsService } from '../services/vendor-package-visits.service';

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-match',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'night',
    registrationNumber: 'KL07AB1234',
    serviceId: 'exterior',
    serviceName: 'Exterior Wash',
    sequence: 1,
    ordinal: 1,
    status: 'SCHEDULED',
    durationMinutes: 30,
    schedule: {
      date: '2026-10-30',
      startTime: '21:00',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      durationMinutes: 30,
    },
    scheduleHistory: [],
    entitlementConsumed: false,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('vendor package visit handlers through request middleware', () => {
  const now = () => new Date('2026-10-29T02:30:00.000Z');
  let plans: jest.Mocked<Pick<CustomerPlansRepository, 'queryVendorPackageVisits' | 'listVendorVisitsForDate' | 'getPlan'>>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let service: VendorPackageVisitsService;

  beforeEach(() => {
    plans = {
      queryVendorPackageVisits: jest.fn().mockResolvedValue({
        items: [
          { record: visit(), resumeKey: { PK: 'a' } },
          { record: visit({ visitId: 'other-community', communityId: 'community-2', registrationNumber: 'KL07ZZ9999' }), resumeKey: { PK: 'b' } },
          { record: visit({ visitId: 'other-search', registrationNumber: 'KL99XX0000' }), resumeKey: { PK: 'c' } },
          { record: visit({ visitId: 'other-status', status: 'IN_PROGRESS' }), resumeKey: { PK: 'd' } },
          { record: visit({ visitId: 'other-window', visitWindowId: 'morning' }), resumeKey: { PK: 'e' } },
        ],
      }),
      listVendorVisitsForDate: jest.fn().mockResolvedValue([]),
      getPlan: jest.fn().mockResolvedValue(null),
    };
    vendors = {
      getOperationalAccess: jest.fn().mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true }),
    };
    service = new VendorPackageVisitsService(
      plans as unknown as CustomerPlansRepository,
      vendors,
      now,
    );
  });

  it('applies date, community, window, status, search, and limit from middleware params', async () => {
    const request = buildRequestContext({
      pathParameters: { vendorId: 'vendor-1' },
      queryStringParameters: {
        date: '2026-10-30',
        communityId: 'community-1',
        visitWindowId: 'night',
        status: 'SCHEDULED',
        search: 'kl07',
        limit: '10',
      },
      requestContext: {
        authorizer: { identityId: 'owner-1', userId: 'owner-1' },
      },
    });

    expect(request).not.toHaveProperty('queryStringParameters');
    expect(request.params).toMatchObject({
      date: '2026-10-30',
      communityId: 'community-1',
      visitWindowId: 'night',
      status: 'SCHEDULED',
      search: 'kl07',
      limit: '10',
    });

    const page = await service.list(request);
    expect(plans.queryVendorPackageVisits).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'vendor-1',
      fromDate: '2026-10-30',
      toDate: '2026-10-30',
      status: 'SCHEDULED',
    }));
    expect(page.items.map((item) => item.visitId)).toEqual(['visit-match']);
  });

  it('applies summary fromDate and toDate from middleware params', async () => {
    const request = buildRequestContext({
      pathParameters: { vendorId: 'vendor-1' },
      queryStringParameters: { fromDate: '2026-10-30', toDate: '2026-10-31' },
      requestContext: {
        authorizer: { identityId: 'owner-1', userId: 'owner-1' },
      },
    });

    await service.summary(request);
    expect(plans.listVendorVisitsForDate.mock.calls.map((call) => call[1])).toEqual([
      '2026-10-30',
      '2026-10-31',
    ]);
  });
});
