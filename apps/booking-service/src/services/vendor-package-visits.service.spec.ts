import { ForbiddenError, LambdaRequest, ValidationError } from '@api-hub/utils';

import { OperationalAccessGateway } from '../integrations/vendor.client';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { CustomerPlanRecord } from '../types/customer-plan.types';
import { PackageVisitRecord } from '../types/package-visit.types';
import { VendorPackageVisitsService } from './vendor-package-visits.service';

const plan = {
  planId: 'plan-1',
  customerId: 'customer-1',
  vendorId: 'vendor-1',
  packageId: 'pkg',
  offeringId: 'pkg',
  vehicleId: 'vehicle-1',
  vehicleType: 'HATCHBACK',
  vehicleRegistrationNumber: 'KL07AB1234',
  vehicleDisplayName: 'Hyundai i20',
  status: 'ACTIVE',
  paymentStatus: 'PAID',
  billingPeriod: 'monthly',
  cadence: 'MONTHLY',
  remainingVisits: 1,
  entitlements: [],
  includedServices: [],
  visitWindowId: 'night',
  visitWindow: { visitWindowId: 'night', label: 'Night' },
  location: { fulfilmentType: 'community', communityId: 'community-1' },
  pricingSnapshot: {
    totalAmount: 1,
    totalMinor: 1,
    currency: 'INR',
    packageId: 'pkg',
    offeringId: 'pkg',
    vehicleType: 'HATCHBACK',
  },
  autoRenew: false,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as CustomerPlanRecord;

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    serviceId: 'exterior',
    serviceName: 'Exterior Wash',
    sequence: 1,
    ordinal: 1,
    status: 'SCHEDULED',
    durationMinutes: 30,
    schedule: {
      date: '2026-10-29',
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

function request(input: {
  userId?: string;
  roles?: string[];
  vendorId?: string;
  query?: Record<string, string>;
} = {}): LambdaRequest {
  return {
    pathParameters: { vendorId: input.vendorId ?? 'vendor-1' },
    queryStringParameters: input.query ?? {},
    context: {
      authContext: {
        userId: input.userId ?? 'owner-1',
        roles: input.roles ?? [],
        permissions: [],
        claims: {},
      },
    },
  } as unknown as LambdaRequest;
}

describe('VendorPackageVisitsService', () => {
  let plans: jest.Mocked<Pick<CustomerPlansRepository, 'queryVendorScheduledVisits' | 'listVendorVisitsForDate' | 'getPlan'>>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let service: VendorPackageVisitsService;

  beforeEach(() => {
    plans = {
      queryVendorScheduledVisits: jest.fn().mockResolvedValue({
        items: [{ record: visit(), resumeKey: { PK: 'a', SK: 'b', GSI3PK: 'c', GSI3SK: 'd' } }],
      }),
      listVendorVisitsForDate: jest.fn().mockImplementation(async (_vendorId: string, date: string) => (
        date === '2026-10-29' ? [visit(), visit({ visitId: 'later', status: 'UNSCHEDULED', schedule: undefined })] : []
      )),
      getPlan: jest.fn().mockResolvedValue(plan),
    };
    vendors = {
      getOperationalAccess: jest.fn().mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true }),
    };
    service = new VendorPackageVisitsService(
      plans as unknown as CustomerPlansRepository,
      vendors,
      () => new Date('2026-10-29T02:30:00.000Z'),
    );
  });

  it('lists the owner vendor and enriches visits that predate the snapshot', async () => {
    const page = await service.list(request());
    expect(vendors.getOperationalAccess).toHaveBeenCalledWith('owner-1');
    expect(plans.queryVendorScheduledVisits).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'vendor-1',
      fromDate: '2026-10-29',
      toDate: '2026-10-29',
    }));
    expect(page.items[0]).toMatchObject({
      visitId: 'visit-1',
      communityId: 'community-1',
      visitWindowName: 'Night',
      scheduledDate: '2026-10-29',
      vehicle: { registrationNumber: 'KL07AB1234', displayName: 'Hyundai i20' },
    });
    expect(page.items[0]).not.toHaveProperty('customerId');
    expect(page.nextToken).toBeNull();
  });

  it('denies staff and a vendor id that is not the membership', async () => {
    vendors.getOperationalAccess.mockResolvedValue({ role: 'staff', vendorId: 'vendor-1', staffId: 'staff-1', active: true });
    await expect(service.list(request())).rejects.toBeInstanceOf(ForbiddenError);
    vendors.getOperationalAccess.mockResolvedValue({ role: 'owner', vendorId: 'vendor-1', active: true });
    await expect(service.list(request({ vendorId: 'vendor-2' }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(plans.queryVendorScheduledVisits).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller before reading visits', async () => {
    await expect(service.list(request({ userId: '' }))).rejects.toThrow();
    expect(plans.queryVendorScheduledVisits).not.toHaveBeenCalled();
  });

  it('filters community, window, status, and registration on the server page', async () => {
    plans.queryVendorScheduledVisits.mockResolvedValue({
      items: [
        { record: visit(), resumeKey: { PK: '1' } },
        { record: visit({ visitId: 'other', registrationNumber: 'MH01CD9999' }), resumeKey: { PK: '2' } },
      ],
    });
    const page = await service.list(request({
      query: { search: 'kl07', communityId: 'community-1', visitWindowId: 'night', status: 'SCHEDULED' },
    }));
    expect(page.items.map((item) => item.visitId)).toEqual(['visit-1']);
  });

  it('returns a next token without repeating the last included visit', async () => {
    const rows = [1, 2, 3].map((ordinal) => ({
      record: visit({ visitId: `visit-${ordinal}`, ordinal }),
      resumeKey: { PK: 'CUSTOMER_PLAN#plan-1', SK: `VISIT#00${ordinal}`, GSI3PK: 'p', GSI3SK: `s${ordinal}` },
    }));
    plans.queryVendorScheduledVisits.mockImplementation(async (input) => {
      const start = typeof input.exclusiveStartKey?.SK === 'string' ? input.exclusiveStartKey.SK : '';
      const items = start ? rows.filter((row) => String(row.resumeKey.SK) > start) : rows;
      return { items };
    });
    const page = await service.list(request({ query: { limit: '2' } }));
    expect(page.items.map((item) => item.visitId)).toEqual(['visit-1', 'visit-2']);
    expect(page.nextToken).toBeTruthy();
    const second = await service.list(request({ query: { limit: '2', nextToken: page.nextToken! } }));
    expect(plans.queryVendorScheduledVisits).toHaveBeenLastCalledWith(expect.objectContaining({
      exclusiveStartKey: rows[1].resumeKey,
    }));
    expect(second.items.map((item) => item.visitId)).toEqual(['visit-3']);
  });

  it('summarizes dated demand and drops the unscheduled entitlement', async () => {
    const summary = await service.summary(request({ query: { fromDate: '2026-10-29', toDate: '2026-10-29' } }));
    expect(summary.metrics.expected).toBe(1);
    expect(summary.demand.totalScheduled).toBe(1);
    expect(summary.complete).toBe(true);
    expect(plans.listVendorVisitsForDate).toHaveBeenCalledWith('vendor-1', '2026-10-29');
  });

  it('rejects an invalid next token', async () => {
    await expect(service.list(request({ query: { nextToken: '###' } }))).rejects.toBeInstanceOf(ValidationError);
  });
});
