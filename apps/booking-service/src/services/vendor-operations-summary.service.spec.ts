import { ForbiddenError, LambdaRequest, ValidationError } from '@api-hub/utils';

import { OperationalAccessGateway } from '../integrations/vendor.client';
import { BookingsRepository } from '../repositories/bookings.repository';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { Booking } from '../types/api-types';
import { PackageVisitRecord } from '../types/package-visit.types';
import { VendorOperationsSummarySchema } from '../schemas/vendor-operations-summary.schema';
import { VendorOperationsSummaryService } from './vendor-operations-summary.service';

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'night',
    visitWindowName: 'Night',
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

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    customerId: 'customer-2',
    vendorId: 'vendor-1',
    bookingDate: '2026-10-29',
    bookingStatus: 'CONFIRMED',
    schedule: {
      date: '2026-10-29',
      startTime: '10:00',
      endTime: '10:45',
      durationMinutes: 45,
      timezone: 'Asia/Kolkata',
      startAtUtc: '2026-10-29T04:30:00.000Z',
      endAtUtc: '2026-10-29T05:15:00.000Z',
    },
    location: { fulfilmentType: 'community', communityId: 'community-1' },
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
    queryStringParameters: input.query ?? { fromDate: '2026-10-29', toDate: '2026-10-29' },
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

describe('VendorOperationsSummaryService', () => {
  let plans: jest.Mocked<Pick<
    CustomerPlansRepository,
    'listVendorVisitsForDate' | 'getPlan' | 'sampleVendorVisitTimezone'
  >>;
  let bookings: jest.Mocked<Pick<
    BookingsRepository,
    'listVendorBookingsForDateRange' | 'sampleVendorBookingTimezone'
  >>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let service: VendorOperationsSummaryService;

  beforeEach(() => {
    plans = {
      listVendorVisitsForDate: jest.fn().mockResolvedValue([visit()]),
      getPlan: jest.fn().mockResolvedValue(null),
      sampleVendorVisitTimezone: jest.fn().mockResolvedValue('Asia/Kolkata'),
    };
    bookings = {
      listVendorBookingsForDateRange: jest.fn().mockResolvedValue([booking()]),
      sampleVendorBookingTimezone: jest.fn().mockResolvedValue(undefined),
    };
    vendors = {
      getOperationalAccess: jest.fn().mockResolvedValue({
        role: 'owner',
        vendorId: 'vendor-1',
        active: true,
      }),
    };
    service = new VendorOperationsSummaryService(
      plans as unknown as CustomerPlansRepository,
      bookings as unknown as BookingsRepository,
      vendors,
    );
  });

  it('returns owner summary with package visits and one-time bookings', async () => {
    const result = await service.summary(request());
    expect(result.metrics.expected).toBe(2);
    expect(result.metrics.waiting).toBe(2);
    expect(result.timezone).toBe('Asia/Kolkata');
    expect(VendorOperationsSummarySchema.safeParse(result).success).toBe(true);
    expect(plans.listVendorVisitsForDate).toHaveBeenCalledWith('vendor-1', '2026-10-29');
    expect(bookings.listVendorBookingsForDateRange).toHaveBeenCalledWith(
      'vendor-1',
      '2026-10-29',
      '2026-10-29',
    );
  });

  it('returns the empty documented shape and samples timezone outside the empty range', async () => {
    plans.listVendorVisitsForDate.mockResolvedValue([]);
    bookings.listVendorBookingsForDateRange.mockResolvedValue([]);
    const result = await service.summary(request());
    expect(result).toEqual({
      fromDate: '2026-10-29',
      toDate: '2026-10-29',
      timezone: 'Asia/Kolkata',
      metrics: {
        expected: 0,
        completed: 0,
        inProgress: 0,
        waiting: 0,
        missed: 0,
        cancelled: 0,
      },
      needsAttention: [],
      communities: [],
    });
    expect(plans.sampleVendorVisitTimezone).toHaveBeenCalledWith('vendor-1');
  });

  it('rejects missing and reversed dates with ValidationError', async () => {
    await expect(service.summary(request({ query: {} }))).rejects.toBeInstanceOf(ValidationError);
    await expect(service.summary(request({
      query: { fromDate: '2026-10-30', toDate: '2026-10-29' },
    }))).rejects.toThrow(/fromDate must be on or before toDate/);
    expect(plans.listVendorVisitsForDate).not.toHaveBeenCalled();
    expect(bookings.listVendorBookingsForDateRange).not.toHaveBeenCalled();
  });

  it('denies cross-vendor access and allows platform admin', async () => {
    await expect(service.summary(request({ vendorId: 'other-vendor' }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    vendors.getOperationalAccess.mockClear();
    const admin = await service.summary(request({
      roles: ['admin'],
      vendorId: 'other-vendor',
      query: { fromDate: '2026-10-29', toDate: '2026-10-29' },
    }));
    expect(admin.fromDate).toBe('2026-10-29');
    expect(vendors.getOperationalAccess).not.toHaveBeenCalled();
    expect(plans.listVendorVisitsForDate).toHaveBeenCalledWith('other-vendor', '2026-10-29');
  });

  it('is read-only and does not invoke write repositories', async () => {
    const writePlans = plans as unknown as { saveVisit?: jest.Mock; saveVisits?: jest.Mock };
    const writeBookings = bookings as unknown as {
      createBooking?: jest.Mock;
      updateBooking?: jest.Mock;
    };
    await service.summary(request());
    expect(writePlans.saveVisit).toBeUndefined();
    expect(writePlans.saveVisits).toBeUndefined();
    expect(writeBookings.createBooking).toBeUndefined();
    expect(writeBookings.updateBooking).toBeUndefined();
  });

  it('applies vendor-timezone day boundaries across a multi-day range', async () => {
    plans.listVendorVisitsForDate
      .mockResolvedValueOnce([visit()])
      .mockResolvedValueOnce([visit({
        visitId: 'visit-2',
        schedule: {
          date: '2026-10-30',
          startTime: '09:00',
          timezone: 'Asia/Kolkata',
          branchId: 'branch-1',
          durationMinutes: 30,
        },
      })]);
    bookings.listVendorBookingsForDateRange.mockResolvedValue([]);
    const result = await service.summary(request({
      query: { fromDate: '2026-10-29', toDate: '2026-10-30' },
    }));
    expect(plans.listVendorVisitsForDate.mock.calls.map((call) => call[1])).toEqual([
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(result.metrics.expected).toBe(2);
    expect(result.timezone).toBe('Asia/Kolkata');
  });
});
