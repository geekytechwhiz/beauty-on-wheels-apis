import { ConditionalWriteConflictError } from '@api-hub/utils';
import { LambdaRequest } from '@api-hub/utils';

import { BookingsService } from './bookings.service';
import { BookingsRepository } from '../repositories/bookings.repository';
import { BookingError } from '../errors';
import { payableAmount, requestFingerprint } from '../domain/create-booking';
import { validateCreateBooking } from '../schemas/bookings.schema';
import { CatalogGateway } from '../integrations/catalog.client';
import { VehicleGateway } from '../integrations/vehicle.client';
import { VendorGateway } from '../integrations/vendor.client';
import { AvailabilityGateway } from '../integrations/availability.client';
import { UserGateway } from '../integrations/user.client';
import { Booking } from '../types/api-types';
import { BookingDdbItem } from '../types/repository.types';

const command = {
  vendorId: 'vendor_001',
  branchId: 'branch_001',
  vehicleId: 'vehicle_001',
  offeringId: 'offering_001',
  offeringVersion: 2,
  slotId: 'slot_001',
  holdId: 'hold_001',
  location: {
    fulfilmentType: 'COMMUNITY',
    communityId: 'community_001',
    addressId: 'address_001',
  },
};

function fingerprint(body: unknown = command): string {
  return requestFingerprint(validateCreateBooking({ body } as LambdaRequest));
}

function request(body: unknown = command, key = 'idem-1'): LambdaRequest {
  return {
    body,
    context: {
      authContext: { userId: 'customer-1', identityId: 'cognito-sub', roles: [], permissions: [], claims: {} },
      authHeader: 'Bearer token',
      correlationId: 'corr-1',
    },
    event: { headers: { 'Idempotency-Key': key } },
  } as unknown as LambdaRequest;
}

function pendingItem(overrides: Partial<BookingDdbItem> = {}): BookingDdbItem {
  return {
    PK: 'BOOKING#booking-1',
    SK: 'BOOKING#booking-1',
    GSI1PK: 'BOOKING_LIST',
    GSI1SK: 'BOOKING#2026-10-12#booking-1',
    id: 'booking-1',
    customerId: 'customer-1',
    vendorId: 'vendor_001',
    branchId: 'branch_001',
    vehicleId: 'vehicle_001',
    serviceIds: ['offering_001'],
    offeringId: 'offering_001',
    offeringVersion: 2,
    bookingDate: '2026-10-12',
    slotId: 'slot_001',
    holdId: 'hold_001',
    pricingSnapshot: {
      offeringId: 'offering_001',
      offeringVersion: 2,
      catalogVersion: 4,
      vendorPricingVersion: 1,
      baseAmount: 499,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 499,
      currency: 'INR',
    },
    totalAmount: 499,
    paymentStatus: 'PENDING',
    bookingStatus: 'PENDING',
    version: 1,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    entityType: 'Booking',
    ...overrides,
  };
}

describe('Create booking flow', () => {
  let repository: jest.Mocked<BookingsRepository>;
  let catalog: jest.Mocked<CatalogGateway>;
  let vehicles: jest.Mocked<VehicleGateway>;
  let vendors: jest.Mocked<VendorGateway>;
  let availability: jest.Mocked<AvailabilityGateway>;
  let users: jest.Mocked<UserGateway>;
  let service: BookingsService;

  beforeEach(() => {
    repository = {
      getIdempotency: jest.fn().mockResolvedValue(null),
      getHoldBooking: jest.fn().mockResolvedValue(null),
      createBooking: jest.fn().mockImplementation(async (booking: Booking) => booking),
      getBookingDetailsItem: jest.fn().mockImplementation(async (id: string) => pendingItem({ id })),
      updateBookingStatus: jest.fn().mockResolvedValue(undefined),
      getBookingById: jest.fn().mockImplementation(async (id: string) => ({
        ...pendingItem({ id }),
        bookingStatus: 'CREATED',
      })),
      cancelBooking: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BookingsRepository>;

    catalog = {
      getOffering: jest.fn().mockResolvedValue({
        id: 'offering_001',
        active: true,
        vehicleTypes: ['SEDAN'],
        version: 2,
      }),
      priceOffering: jest.fn().mockResolvedValue({
        currency: 'INR',
        subtotal: 499,
        discount: 0,
        addOnTotal: 0,
        total: 499,
        unitPrice: 499,
        offeringVersion: 2,
        catalogVersion: 4,
        vendorPricingVersion: 1,
      }),
    };
    vehicles = {
      getVehicle: jest.fn().mockResolvedValue({
        id: 'vehicle_001',
        userId: 'customer-1',
        vehicleType: 'SEDAN',
        brand: 'Honda',
        model: 'City',
      }),
    };
    vendors = {
      getCheckoutEligibility: jest.fn().mockResolvedValue({
        vendor: {
          vendorId: 'vendor_001',
          status: 'ACTIVE',
          operationalStatus: 'ONLINE',
          onboardingStatus: 'COMPLETED',
          communityIds: ['community_001'],
        },
        branch: {
          branchId: 'branch_001',
          vendorId: 'vendor_001',
        },
      }),
    };
    availability = {
      getSlot: jest.fn().mockResolvedValue({
        id: 'slot_001',
        vendorId: 'vendor_001',
        branchId: 'branch_001',
        date: '2026-10-12',
        status: 'available',
        serviceIds: ['offering_001'],
        vehicleTypeIds: ['SEDAN'],
      }),
      getHold: jest.fn().mockResolvedValue({
        holdId: 'hold_001',
        slotId: 'slot_001',
        vendorId: 'vendor_001',
        branchId: 'branch_001',
        customerId: 'customer-1',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
      consumeHold: jest.fn().mockResolvedValue({ bookingId: 'booking-1', slotId: 'slot_001' }),
      releaseAllocation: jest.fn().mockResolvedValue(undefined),
    };
    users = {
      getProfile: jest.fn().mockResolvedValue({ communityIds: ['community_001'] }),
      assertAddress: jest.fn().mockResolvedValue(undefined),
    };

    service = new BookingsService(
      repository,
      catalog,
      vehicles,
      vendors,
      availability,
      users,
      () => new Date('2026-10-12T00:00:00.000Z'),
    );
  });

  it('creates a booking without quoteId and snapshots the catalog price', async () => {
    const result = await service.postbookings(request());

    expect(result.bookingStatus).toBe('CREATED');
    expect(result.totalAmount).toBe(499);
    expect(result.pricingSnapshot).toMatchObject({
      offeringId: 'offering_001',
      offeringVersion: 2,
      catalogVersion: 4,
      vendorPricingVersion: 1,
      baseAmount: 499,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 499,
      currency: 'INR',
    });
    expect(payableAmount(result)).toBe(499);
    expect(catalog.priceOffering).toHaveBeenCalledWith(expect.objectContaining({
      offeringId: 'offering_001',
      vendorId: 'vendor_001',
      vehicleType: 'SEDAN',
    }));
    expect(catalog.getOffering).toHaveBeenCalledWith(expect.objectContaining({
      offeringId: 'offering_001',
      vendorId: 'vendor_001',
    }));
    expect(availability.consumeHold).toHaveBeenCalledWith(expect.objectContaining({
      holdId: 'hold_001',
    }));
    const persisted = repository.createBooking.mock.calls[0][0];
    expect(persisted.customerId).toBe('customer-1');
    expect(persisted.bookingStatus).toBe('PENDING');
    expect(persisted.totalAmount).toBe(499);
    expect(persisted).not.toHaveProperty('quoteId');
  });

  it('uses the vendor-specific catalog total', async () => {
    catalog.priceOffering.mockResolvedValue({
      currency: 'INR',
      subtotal: 650,
      discount: 50,
      addOnTotal: 0,
      total: 600,
      unitPrice: 650,
      offeringVersion: 2,
      catalogVersion: 4,
      vendorPricingVersion: 3,
    });

    await service.postbookings(request());

    expect(repository.createBooking.mock.calls[0][0].pricingSnapshot).toMatchObject({
      baseAmount: 650,
      discountAmount: 50,
      totalAmount: 600,
    });
  });

  it('rejects a stale offering version before persisting or consuming the hold', async () => {
    catalog.priceOffering.mockResolvedValue({
      currency: 'INR',
      subtotal: 899,
      discount: 0,
      addOnTotal: 0,
      total: 899,
      unitPrice: 899,
      offeringVersion: 3,
      catalogVersion: 5,
      vendorPricingVersion: 2,
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'OFFERING_VERSION_MISMATCH',
      statusCode: 409,
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('rejects a missing authoritative version as a dependency failure', async () => {
    catalog.priceOffering.mockResolvedValue({
      currency: 'INR',
      subtotal: 499,
      discount: 0,
      addOnTotal: 0,
      total: 499,
      unitPrice: 499,
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'CATALOG_PRICING_UNAVAILABLE',
      statusCode: 502,
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('rejects an ineligible vendor before creating a booking', async () => {
    vendors.getCheckoutEligibility.mockResolvedValue({
      vendor: {
        vendorId: 'vendor_001',
        status: 'SUSPENDED',
        operationalStatus: 'ONLINE',
        onboardingStatus: 'COMPLETED',
        communityIds: ['community_001'],
      },
      branch: { branchId: 'branch_001', vendorId: 'vendor_001' },
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'VENDOR_NOT_ELIGIBLE',
      statusCode: 409,
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('does not create a booking when vendor eligibility is unavailable', async () => {
    vendors.getCheckoutEligibility.mockRejectedValue(
      new BookingError('DEPENDENCY_UNAVAILABLE', 'Vendor Service could not be invoked', 502, undefined, true),
    );

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      statusCode: 502,
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('does not consume the hold when pricing revision conflicts', async () => {
    catalog.priceOffering.mockRejectedValue(
      new BookingError('OFFERING_REVISION_CONFLICT', 'Pricing inputs changed concurrently', 409),
    );

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'OFFERING_REVISION_CONFLICT',
      statusCode: 409,
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('rejects a community the vendor does not cover', async () => {
    vendors.getCheckoutEligibility.mockResolvedValue({
      vendor: {
        vendorId: 'vendor_001',
        status: 'ACTIVE',
        operationalStatus: 'ONLINE',
        onboardingStatus: 'COMPLETED',
        communityIds: ['other-community'],
      },
      branch: { branchId: 'branch_001', vendorId: 'vendor_001' },
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'COMMUNITY_NOT_SERVED',
      statusCode: 409,
    });
    expect(catalog.priceOffering).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('rejects a vehicle owned by someone else', async () => {
    vehicles.getVehicle.mockResolvedValue({
      id: 'vehicle_001',
      userId: 'other-customer',
      vehicleType: 'SEDAN',
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'VEHICLE_NOT_OWNED',
      statusCode: 403,
    });
    expect(catalog.priceOffering).not.toHaveBeenCalled();
  });

  it('rejects a branch that belongs to another vendor', async () => {
    vendors.getCheckoutEligibility.mockResolvedValue({
      vendor: {
        vendorId: 'vendor_001',
        status: 'ACTIVE',
        operationalStatus: 'ONLINE',
        onboardingStatus: 'COMPLETED',
        communityIds: ['community_001'],
      },
      branch: { branchId: 'branch_001', vendorId: 'other-vendor' },
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'VENDOR_BRANCH_MISMATCH',
      statusCode: 409,
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
  });

  it('rejects an expired hold', async () => {
    availability.getHold.mockResolvedValue({
      holdId: 'hold_001',
      slotId: 'slot_001',
      vendorId: 'vendor_001',
      branchId: 'branch_001',
      customerId: 'customer-1',
      status: 'active',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'HOLD_EXPIRED',
      statusCode: 409,
    });
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('does not consume the hold when persistence fails', async () => {
    repository.createBooking.mockRejectedValue(new Error('dynamodb unavailable'));

    await expect(service.postbookings(request())).rejects.toThrow('dynamodb unavailable');
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('cancels the pending booking when hold consumption fails', async () => {
    availability.consumeHold.mockRejectedValue(
      new BookingError('HOLD_EXPIRED', 'Hold has expired', 409, 'holdId', false),
    );

    await expect(service.postbookings(request())).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });
    expect(repository.cancelBooking).toHaveBeenCalled();
    expect(repository.updateBookingStatus).not.toHaveBeenCalled();
  });

  it('leaves the booking pending when availability is unavailable', async () => {
    availability.consumeHold.mockRejectedValue(
      new BookingError('AVAILABILITY_UNAVAILABLE', 'invoke failed', 502, undefined, true),
    );

    await expect(service.postbookings(request())).rejects.toMatchObject({ statusCode: 502 });
    expect(repository.cancelBooking).not.toHaveBeenCalled();
    expect(repository.updateBookingStatus).not.toHaveBeenCalled();
  });

  it('returns the existing booking for an idempotent retry', async () => {
    repository.getIdempotency.mockResolvedValue({
      PK: 'IDEMPOTENCY#customer-1#idem-1',
      SK: 'IDEMPOTENCY',
      bookingId: 'booking-1',
      customerId: 'customer-1',
      holdId: 'hold_001',
      requestHash: fingerprint(),
      entityType: 'BookingIdempotency',
    });
    repository.getBookingDetailsItem.mockResolvedValue(pendingItem({ bookingStatus: 'CREATED' }));

    const result = await service.postbookings(request());

    expect(result.id).toBe('booking-1');
    expect(result.bookingStatus).toBe('CREATED');
    expect(result.pricingSnapshot).toMatchObject({
      offeringVersion: 2,
      totalAmount: 499,
      currency: 'INR',
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
    expect(catalog.priceOffering).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('resumes an in-flight booking after a concurrent create conflict', async () => {
    repository.createBooking.mockRejectedValue(new ConditionalWriteConflictError('duplicate'));
    repository.getIdempotency
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        PK: 'IDEMPOTENCY#customer-1#idem-1',
        SK: 'IDEMPOTENCY',
        bookingId: 'booking-1',
        customerId: 'customer-1',
        holdId: 'hold_001',
        requestHash: fingerprint(),
        entityType: 'BookingIdempotency',
      });

    const result = await service.postbookings(request());

    expect(result.bookingStatus).toBe('CREATED');
    expect(availability.consumeHold).toHaveBeenCalledTimes(1);
  });

  it('keeps the snapshotted price when the catalog price later changes', async () => {
    const created = await service.postbookings(request());
    catalog.priceOffering.mockResolvedValue({
      currency: 'INR',
      subtotal: 899,
      discount: 0,
      addOnTotal: 0,
      total: 899,
      unitPrice: 899,
      offeringVersion: 4,
      catalogVersion: 6,
      vendorPricingVersion: 1,
    });
    repository.getBookingById.mockResolvedValue({
      ...created,
      id: 'booking-1',
      bookingStatus: 'CREATED',
      pricingSnapshot: repository.createBooking.mock.calls[0][0].pricingSnapshot,
      totalAmount: 499,
    });

    const loaded = await service.getbookingid({
      pathParameters: { bookingId: 'booking-1' },
      context: {},
    } as unknown as LambdaRequest);

    expect(loaded.pricingSnapshot?.totalAmount).toBe(499);
    expect(catalog.priceOffering).toHaveBeenCalledTimes(1);
  });

  it('does not invent a price when catalog omits the total', async () => {
    catalog.priceOffering.mockResolvedValue({
      currency: 'INR',
      subtotal: Number.NaN,
      discount: Number.NaN,
      addOnTotal: Number.NaN,
      total: Number.NaN,
    });

    await expect(service.postbookings(request())).rejects.toMatchObject({
      code: 'CATALOG_PRICING_UNAVAILABLE',
    });
    expect(repository.createBooking).not.toHaveBeenCalled();
  });

  it('accepts an address fulfilment without requiring a community', async () => {
    const result = await service.postbookings(request({
      ...command,
      location: { fulfilmentType: 'address', addressId: 'address_001' },
    }, 'idem-address'));

    expect(result.bookingStatus).toBe('CREATED');
    expect(users.assertAddress).toHaveBeenCalledWith('customer-1', 'address_001', 'Bearer token');
  });
});
