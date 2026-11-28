import { LambdaRequest } from '@api-hub/utils';

import { OperationalAccessGateway } from '../integrations/vendor.client';
import { BookingsRepository } from '../repositories/bookings.repository';
import { CustomerPlansRepository } from '../repositories/customer-plans.repository';
import { Booking } from '../types/api-types';
import { PACKAGE_VISIT_STATUS, PackageVisitRecord } from '../types/package-visit.types';
import { VendorHomeSummarySchema } from '../schemas/vendor-home-summary.schema';
import { VendorHomeSummaryService } from './vendor-home-summary.service';

function visit(overrides: Partial<PackageVisitRecord> = {}): PackageVisitRecord {
  return {
    visitId: 'visit-1',
    planId: 'plan-1',
    customerId: 'customer-1',
    vendorId: 'vendor-1',
    communityId: 'community-1',
    visitWindowId: 'evening',
    visitWindowName: 'Evening',
    serviceId: 'exterior',
    serviceName: 'Exterior',
    sequence: 1,
    ordinal: 1,
    status: PACKAGE_VISIT_STATUS.SCHEDULED,
    durationMinutes: 30,
    schedule: {
      date: '2026-11-20',
      startTime: '18:00',
      timezone: 'Asia/Kolkata',
      branchId: 'branch-1',
      durationMinutes: 30,
    },
    scheduleHistory: [],
    entitlementConsumed: false,
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    customerId: 'customer-2',
    vendorId: 'vendor-1',
    bookingDate: '2026-11-20',
    bookingStatus: 'CONFIRMED',
    schedule: {
      date: '2026-11-20',
      startTime: '10:00',
      endTime: '10:45',
      durationMinutes: 45,
      timezone: 'Asia/Kolkata',
      startAtUtc: '2026-11-20T04:30:00.000Z',
      endAtUtc: '2026-11-20T05:15:00.000Z',
    },
    location: { fulfilmentType: 'community', communityId: 'community-1' },
    ...overrides,
  };
}

function request(query: Record<string, string> = {}): LambdaRequest {
  return {
    pathParameters: { vendorId: 'vendor-1' },
    queryStringParameters: query,
    context: {
      authContext: {
        userId: 'owner-1',
        roles: ['vendor_owner'],
        permissions: [],
        claims: {},
      },
    },
  } as unknown as LambdaRequest;
}

describe('VendorHomeSummaryService', () => {
  let plans: jest.Mocked<CustomerPlansRepository>;
  let bookingsRepo: jest.Mocked<BookingsRepository>;
  let vendors: jest.Mocked<OperationalAccessGateway>;
  let service: VendorHomeSummaryService;

  beforeEach(() => {
    plans = {
      listVendorVisitsForDate: jest.fn().mockResolvedValue([]),
      sampleVendorVisitTimezone: jest.fn().mockResolvedValue('Asia/Kolkata'),
      getPlan: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<CustomerPlansRepository>;
    bookingsRepo = {
      listVendorBookingsForDateRange: jest.fn().mockResolvedValue([]),
      sampleVendorBookingTimezone: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BookingsRepository>;
    vendors = {
      getOperationalAccess: jest.fn().mockResolvedValue({
        active: true,
        role: 'owner',
        vendorId: 'vendor-1',
      }),
    } as unknown as jest.Mocked<OperationalAccessGateway>;
    service = new VendorHomeSummaryService(
      plans,
      bookingsRepo,
      vendors,
      () => new Date('2026-11-20T08:00:00.000Z'),
    );
  });

  it('aggregates today and upcoming days from GSI3 day queries and vendor booking range', async () => {
    plans.listVendorVisitsForDate.mockImplementation(async (_vendorId, date) => {
      if (date === '2026-11-20') {
        return [
          visit({ visitId: 'today-1', status: PACKAGE_VISIT_STATUS.COMPLETED }),
          visit({ visitId: 'today-2', status: PACKAGE_VISIT_STATUS.BLOCKED, blockReason: 'Gate locked' }),
        ];
      }
      if (date === '2026-11-21') {
        return [visit({
          visitId: 'tom-1',
          schedule: {
            date: '2026-11-21',
            startTime: '09:00',
            timezone: 'Asia/Kolkata',
            branchId: 'branch-1',
            durationMinutes: 30,
          },
        })];
      }
      return [];
    });
    bookingsRepo.listVendorBookingsForDateRange.mockResolvedValue([
      booking(),
      booking({ id: 'linked', planId: 'plan-1', bookingStatus: 'CONFIRMED' }),
    ]);

    const result = await service.summary(request({ upcomingDays: '2' }));
    expect(plans.listVendorVisitsForDate).toHaveBeenCalledTimes(3);
    expect(bookingsRepo.listVendorBookingsForDateRange).toHaveBeenCalledWith(
      'vendor-1',
      '2026-11-20',
      '2026-11-22',
    );
    expect(result.date).toBe('2026-11-20');
    expect(result.timezone).toBe('Asia/Kolkata');
    expect(result.today?.visits?.completed).toBe(1);
    expect(result.today?.visits?.blocked).toBe(1);
    expect(result.today?.visits?.notStarted).toBe(1);
    expect(result.today?.visits?.total).toBe(3);
    expect(result.tomorrow.totalVisits).toBe(1);
    expect(result.upcoming.days).toHaveLength(2);
    expect(VendorHomeSummarySchema.safeParse(result).success).toBe(true);
  });

  it('falls back to operations timezone when no schedule timezone is stored', async () => {
    plans.sampleVendorVisitTimezone.mockResolvedValue(undefined);
    bookingsRepo.sampleVendorBookingTimezone.mockResolvedValue(undefined);
    const result = await service.summary(request({ date: '2026-11-20' }));
    expect(result.timezone).toBe('Asia/Kolkata');
  });
});
