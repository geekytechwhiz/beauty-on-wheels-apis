import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';

import { BookingChangesService } from './booking-changes.service';
import { AvailabilityGateway } from '../integrations/availability.client';
import { CatalogGateway } from '../integrations/catalog.client';
import { UserGateway } from '../integrations/user.client';
import { VehicleGateway } from '../integrations/vehicle.client';
import { VendorGateway } from '../integrations/vendor.client';
import { BookingChangesRepository } from '../repositories/booking-changes.repository';
import { BookingsRepository } from '../repositories/bookings.repository';
import { PaymentsRepository } from '../repositories/payments.repository';
import { BookingDdbItem } from '../types/repository.types';

const change = {
  changeType: 'PROVIDER',
  vendorId: 'vendor_2',
  branchId: 'branch_2',
  offeringId: 'off_2',
  schedule: { date: '2026-11-02', startTime: '11:00', timezone: 'Asia/Kolkata' },
  expectedPrice: { totalMinor: 549, currency: 'INR' },
};

function original(overrides: Partial<BookingDdbItem> & Record<string, unknown> = {}): BookingDdbItem {
  return {
    PK: 'BOOKING#b1', SK: 'BOOKING#b1', GSI1PK: 'BOOKING_LIST', GSI1SK: 'BOOKING#2026-11-01#b1',
    id: 'b1', customerId: 'customer-1', vendorId: 'vendor_1', vendorName: 'Old Vendor', branchId: 'branch_1', branchName: 'Old Branch',
    vehicleId: 'veh_1', serviceIds: ['off_1'], offeringId: 'off_1', offeringVersion: 1,
    service: { serviceId: 'off_1', name: 'Basic Wash', offeringId: 'off_1', durationMinutes: 45 },
    addOns: [], bookingDate: '2026-11-01', slotId: 'slot_1',
    schedule: { date: '2026-11-01', startTime: '10:00', endTime: '10:45', durationMinutes: 45, timezone: 'Asia/Kolkata', startAtUtc: 'x', endAtUtc: 'y' },
    location: { fulfilmentType: 'community', communityId: 'comm_1' },
    pricingSnapshot: { offeringId: 'off_1', offeringVersion: 1, baseAmount: 499, discountAmount: 0, taxAmount: 0, totalAmount: 499, totalMinor: 499, currency: 'INR' },
    totalAmount: 499, paymentStatus: 'PENDING', bookingStatus: 'PENDING_PAYMENT', version: 3,
    createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z', entityType: 'Booking',
    ...overrides,
  } as BookingDdbItem;
}

function request(body: unknown = change, options: { customerId?: string; key?: string | null } = {}): LambdaRequest {
  const key = options.key === undefined ? 'chg-1' : options.key;
  return {
    body,
    pathParameters: { bookingId: 'b1' },
    context: { authContext: { userId: options.customerId ?? 'customer-1', roles: [], permissions: [], claims: {} }, authHeader: 'Bearer token' },
    event: { headers: key ? { 'Idempotency-Key': key } : {} },
  } as unknown as LambdaRequest;
}

describe('BookingChangesService', () => {
  let bookings: jest.Mocked<BookingsRepository>;
  let changes: jest.Mocked<BookingChangesRepository>;
  let payments: jest.Mocked<PaymentsRepository>;
  let catalog: jest.Mocked<CatalogGateway>;
  let vehicles: jest.Mocked<VehicleGateway>;
  let vendors: jest.Mocked<VendorGateway>;
  let availability: jest.Mocked<AvailabilityGateway>;
  let users: jest.Mocked<UserGateway>;
  let service: BookingChangesService;

  const price = (total: number) => ({
    currency: 'INR', subtotal: total, discount: 0, addOnTotal: 0, total, unitPrice: total,
    offeringVersion: 2, catalogVersion: 4, vendorPricingVersion: 1,
    items: [{ id: 'off_2', name: 'Premium Wash', type: 'SERVICE' as const, unitPrice: total, total }],
  });

  beforeEach(() => {
    bookings = {
      getBookingDetailsItem: jest.fn().mockResolvedValue(original()),
      getBookingById: jest.fn().mockResolvedValue({ id: 'b1', vendorId: 'vendor_2', bookingStatus: 'PENDING_PAYMENT', pricingSnapshot: { currency: 'INR' } }),
    } as unknown as jest.Mocked<BookingsRepository>;
    changes = { getIdempotency: jest.fn().mockResolvedValue(null), commitChange: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<BookingChangesRepository>;
    payments = { listBookingPayments: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<PaymentsRepository>;
    catalog = {
      getOffering: jest.fn().mockResolvedValue({
        id: 'off_2', active: true, vehicleTypes: ['SEDAN'], vehiclePricing: [{ vehicleType: 'SEDAN', price: 549, durationMinutes: 60 }], name: 'Premium Wash', categoryId: 'wash',
      }),
      priceOffering: jest.fn().mockResolvedValue(price(549)),
    };
    vehicles = { getVehicle: jest.fn().mockResolvedValue({ id: 'veh_1', userId: 'customer-1', vehicleType: 'SEDAN' }) };
    vendors = {
      getCheckoutEligibility: jest.fn().mockResolvedValue({
        vendor: { vendorId: 'vendor_2', vendorName: 'New Vendor', status: 'ACTIVE', operationalStatus: 'ONLINE', communityIds: ['comm_1'] },
        branch: { branchId: 'branch_2', vendorId: 'vendor_2', branchName: 'New Branch' },
      }),
    };
    availability = {
      reserveBooking: jest.fn().mockResolvedValue({ slotId: 'slot_2', date: '2026-11-02', startTime: '11:00', endTime: '12:00', timezone: 'Asia/Kolkata', durationMinutes: 60 }),
      consumeHold: jest.fn(),
      releaseAllocation: jest.fn().mockResolvedValue(undefined),
    };
    users = { getProfile: jest.fn().mockResolvedValue({ communityIds: ['comm_1'] }), assertAddress: jest.fn() };
    service = new BookingChangesService(bookings, changes, payments, catalog, vehicles, vendors, availability, users);
  });

  describe('preview', () => {
    it('returns current vs proposed snapshots with a CHARGE impact for a positive delta', async () => {
      const result = await service.preview(request({ ...change, expectedPrice: undefined }));

      expect(result).toMatchObject({
        bookingId: 'b1', changeType: 'PROVIDER', priceDeltaMinor: 50, paymentImpact: 'CHARGE', settlementExecuted: false,
        current: { vendorId: 'vendor_1', pricingSnapshot: { totalMinor: 499 } },
        proposed: { vendorId: 'vendor_2', offeringId: 'off_2', pricingSnapshot: { totalMinor: 549 } },
      });
      expect(result).not.toHaveProperty('refundPolicy');
      expect(availability.reserveBooking).not.toHaveBeenCalled();
    });

    it('reports REFUND with an unresolved policy for a negative delta and executes nothing', async () => {
      catalog.priceOffering.mockResolvedValue(price(399));
      const result = await service.preview(request({ ...change, expectedPrice: { totalMinor: 399, currency: 'INR' } }));
      expect(result).toMatchObject({ priceDeltaMinor: -100, paymentImpact: 'REFUND', refundPolicy: 'UNRESOLVED', settlementExecuted: false });
    });

    it('reports NONE when the price is unchanged', async () => {
      catalog.priceOffering.mockResolvedValue(price(499));
      const result = await service.preview(request({ ...change, expectedPrice: undefined }));
      expect(result).toMatchObject({ priceDeltaMinor: 0, paymentImpact: 'NONE' });
    });

    it('rejects a different owner', async () => {
      await expect(service.preview(request(change, { customerId: 'customer-2' }))).rejects.toMatchObject({ statusCode: 403 });
    });

    it.each(['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])('rejects a %s booking', async (status) => {
      bookings.getBookingDetailsItem.mockResolvedValue(original({ bookingStatus: status as BookingDdbItem['bookingStatus'] }));
      await expect(service.preview(request())).rejects.toMatchObject({ code: 'BOOKING_NOT_CHANGEABLE', statusCode: 409 });
    });

    it('allows a CONFIRMED booking', async () => {
      bookings.getBookingDetailsItem.mockResolvedValue(original({ bookingStatus: 'CONFIRMED', paymentStatus: 'PAID' }));
      await expect(service.preview(request())).resolves.toMatchObject({ bookingPaymentStatus: 'PAID' });
    });

    it('rejects package-plan bookings with PACKAGE_CHANGE_NOT_ALLOWED', async () => {
      bookings.getBookingDetailsItem.mockResolvedValue(original({ planId: 'plan-1' }));
      await expect(service.preview(request())).rejects.toMatchObject({ code: 'PACKAGE_CHANGE_NOT_ALLOWED', statusCode: 409 });
    });

    it('rejects a provider change to the same provider and a service change to the same service', async () => {
      await expect(service.preview(request({ ...change, vendorId: 'vendor_1' }))).rejects.toMatchObject({ code: 'CHANGE_NOT_APPLICABLE' });
      await expect(service.preview(request({ ...change, changeType: 'SERVICE', offeringId: 'off_1' }))).rejects.toMatchObject({ code: 'CHANGE_NOT_APPLICABLE' });
    });

    it('rejects a price mismatch when expectedPrice is supplied', async () => {
      await expect(service.preview(request({ ...change, expectedPrice: { totalMinor: 1, currency: 'INR' } }))).rejects.toMatchObject({ code: 'PRICE_MISMATCH' });
    });

    it('blocks a change while a live payment is pending for the booking', async () => {
      payments.listBookingPayments.mockResolvedValue([{ status: 'PENDING', expiresAt: '2099-01-01T00:00:00.000Z' } as never]);
      await expect(service.preview(request())).rejects.toMatchObject({ code: 'PAYMENT_IN_PROGRESS', statusCode: 409 });
    });

    it('rejects unknown fields and invalid change types', async () => {
      await expect(service.preview(request({ ...change, slotId: 's' }))).rejects.toThrow();
      await expect(service.preview(request({ ...change, changeType: 'VEHICLE' }))).rejects.toThrow();
    });
  });

  describe('commit', () => {
    it('reserves new capacity, swaps the snapshot, then releases the old allocation', async () => {
      const result = await service.commit(request());

      const reserved = availability.reserveBooking.mock.calls[0][0];
      expect(reserved.bookingId).toMatch(/^b1-chg-/);
      expect(reserved).toMatchObject({ vendorId: 'vendor_2', branchId: 'branch_2', offeringId: 'off_2', durationMinutes: 60, communityId: 'comm_1' });
      const committed = changes.commitChange.mock.calls[0][0];
      expect(committed.updated).toMatchObject({
        vendorId: 'vendor_2', branchId: 'branch_2', offeringId: 'off_2', bookingDate: '2026-11-02', allocationId: reserved.bookingId,
        pricingSnapshot: { totalMinor: 549 }, bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING',
      });
      expect(committed.change).toMatchObject({ priceDeltaMinor: 50, paymentImpact: 'CHARGE', releasedAllocationId: 'b1' });
      expect(availability.releaseAllocation).toHaveBeenCalledTimes(1);
      expect(availability.releaseAllocation).toHaveBeenCalledWith('b1');
      expect(result).toMatchObject({ bookingId: 'b1', priceDeltaMinor: 50, paymentImpact: 'CHARGE', settlementExecuted: false });
    });

    it('releases the previously swapped allocation key on a later change', async () => {
      bookings.getBookingDetailsItem.mockResolvedValue(original({ allocationId: 'b1-chg-aaaaaaaa' }));
      await service.commit(request());
      expect(availability.releaseAllocation).toHaveBeenCalledWith('b1-chg-aaaaaaaa');
    });

    it('keeps the original and releases only the new allocation when persistence fails', async () => {
      changes.commitChange.mockRejectedValue(new Error('dynamodb unavailable'));
      await expect(service.commit(request())).rejects.toThrow('dynamodb unavailable');
      const reserved = availability.reserveBooking.mock.calls[0][0].bookingId;
      expect(availability.releaseAllocation).toHaveBeenCalledTimes(1);
      expect(availability.releaseAllocation).toHaveBeenCalledWith(reserved);
      expect(availability.releaseAllocation).not.toHaveBeenCalledWith('b1');
    });

    it('turns a version conflict into 409 and releases only the new allocation', async () => {
      changes.commitChange.mockRejectedValue(new ConditionalWriteConflictError(new Error('conflict')));
      await expect(service.commit(request())).rejects.toMatchObject({ statusCode: 409 });
      expect(availability.releaseAllocation).toHaveBeenCalledTimes(1);
      expect(availability.releaseAllocation).not.toHaveBeenCalledWith('b1');
    });

    it('does not touch the original when the new slot is unavailable', async () => {
      availability.reserveBooking.mockRejectedValue(Object.assign(new Error('full'), { code: 'SLOT_UNAVAILABLE', statusCode: 409 }));
      await expect(service.commit(request())).rejects.toMatchObject({ statusCode: 409 });
      expect(changes.commitChange).not.toHaveBeenCalled();
      expect(availability.releaseAllocation).not.toHaveBeenCalled();
    });

    it('consumes a supplied hold under the new allocation key instead of reserving', async () => {
      availability.consumeHold.mockResolvedValue({
        holdId: 'hold_1', slotId: 'slot_h', vendorId: 'vendor_2', branchId: 'branch_2', customerId: 'customer-1',
        date: '2026-11-02', startTime: '11:00', endTime: '12:00', timezone: 'Asia/Kolkata', durationMinutes: 60,
      });
      await service.commit(request({ ...change, holdId: 'hold_1' }));
      expect(availability.consumeHold).toHaveBeenCalledWith({ holdId: 'hold_1', bookingId: expect.stringMatching(/^b1-chg-/), customerId: 'customer-1' });
      expect(availability.reserveBooking).not.toHaveBeenCalled();
      expect(changes.commitChange.mock.calls[0][0].updated).toMatchObject({ holdId: 'hold_1', slotId: 'slot_h' });
    });

    it('releases a consumed hold that does not match the requested change', async () => {
      availability.consumeHold.mockResolvedValue({
        holdId: 'hold_1', slotId: 'slot_h', vendorId: 'vendor_2', branchId: 'branch_2', customerId: 'customer-1',
        date: '2026-11-02', startTime: '13:00', endTime: '14:00', timezone: 'Asia/Kolkata', durationMinutes: 60,
      });
      await expect(service.commit(request({ ...change, holdId: 'hold_1' }))).rejects.toMatchObject({ code: 'HOLD_MISMATCH' });
      expect(changes.commitChange).not.toHaveBeenCalled();
      expect(availability.releaseAllocation).toHaveBeenCalledTimes(1);
      expect(availability.releaseAllocation).not.toHaveBeenCalledWith('b1');
    });

    it('requires Idempotency-Key and expectedPrice', async () => {
      await expect(service.commit(request(change, { key: null }))).rejects.toThrow('Idempotency-Key');
      await expect(service.commit(request({ ...change, expectedPrice: undefined }))).rejects.toThrow('expectedPrice');
      expect(availability.reserveBooking).not.toHaveBeenCalled();
    });

    it('replays a committed change for the same key and rejects a different payload', async () => {
      const first = await service.commit(request());
      const hash = (changes.commitChange.mock.calls[0][0]).requestHash;
      changes.getIdempotency.mockResolvedValue({ PK: 'p', SK: 's', bookingId: 'b1', changeId: first.changeId, customerId: 'customer-1', requestHash: hash, priceDeltaMinor: 50, entityType: 'BookingChangeIdempotency' });
      availability.reserveBooking.mockClear();

      await expect(service.commit(request())).resolves.toMatchObject({ changeId: first.changeId, priceDeltaMinor: 50 });
      expect(availability.reserveBooking).not.toHaveBeenCalled();
      await expect(service.commit(request({ ...change, branchId: 'branch_9' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('rejects a different owner and package-plan bookings before reserving', async () => {
      await expect(service.commit(request(change, { customerId: 'customer-2' }))).rejects.toMatchObject({ statusCode: 403 });
      bookings.getBookingDetailsItem.mockResolvedValue(original({ planId: 'plan-1' }));
      await expect(service.commit(request())).rejects.toMatchObject({ code: 'PACKAGE_CHANGE_NOT_ALLOWED' });
      expect(availability.reserveBooking).not.toHaveBeenCalled();
    });
  });
});
