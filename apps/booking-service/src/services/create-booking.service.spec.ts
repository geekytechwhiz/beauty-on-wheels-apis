import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';

import { BookingsService } from './bookings.service';
import { BookingsRepository } from '../repositories/bookings.repository';
import { CatalogGateway } from '../integrations/catalog.client';
import { VehicleGateway } from '../integrations/vehicle.client';
import { VendorGateway } from '../integrations/vendor.client';
import { AvailabilityGateway } from '../integrations/availability.client';
import { UserGateway } from '../integrations/user.client';
import { BookingError } from '../errors';
import { Booking } from '../types/api-types';
import { requestFingerprint } from '../domain/create-booking';
import { validateCreateBooking } from '../schemas/bookings.schema';

const command = {
  vendorId: 'vendor_001', branchId: 'branch_001', vehicleId: 'vehicle_001', offeringId: 'offering_001',
  schedule: { date: '2026-10-25', startTime: '10:00', timezone: 'Asia/Kolkata' },
  location: { fulfilmentType: 'COMMUNITY', communityId: 'community_001' },
  addOnIds: [], expectedPrice: { totalMinor: 499, currency: 'INR' }, notes: 'Please call before arrival',
};

const heldReservation = {
  holdId: 'hold-1', slotId: 'held-slot', vendorId: 'vendor_001', branchId: 'branch_001', customerId: 'customer-1',
  date: '2026-10-25', startTime: '10:00', endTime: '12:00', timezone: 'Asia/Kolkata', durationMinutes: 120,
};

function request(body: unknown = command, key = 'idem-1'): LambdaRequest {
  return { body, context: { authContext: { userId: 'customer-1', roles: [], permissions: [], claims: {} }, authHeader: 'Bearer token' }, event: { headers: { 'Idempotency-Key': key } } } as unknown as LambdaRequest;
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
    repository = { getIdempotency: jest.fn().mockResolvedValue(null), createBooking: jest.fn().mockImplementation(async (booking: Booking) => booking), getBookingDetailsItem: jest.fn(), getBookingById: jest.fn(), updateBookingStatus: jest.fn() } as unknown as jest.Mocked<BookingsRepository>;
    catalog = {
      getOffering: jest.fn().mockResolvedValue({
        id: 'offering_001',
        active: true,
        vehicleTypes: ['SEDAN'],
        vehiclePricing: [{ vehicleType: 'SEDAN', price: 499, durationMinutes: 45 }],
        name: 'Premium Wash',
        categoryId: 'wash',
        durationMinutes: 45,
      }),
      priceOffering: jest.fn().mockResolvedValue({ currency: 'INR', subtotal: 499, discount: 0, addOnTotal: 0, total: 499, unitPrice: 499, offeringVersion: 2, catalogVersion: 4, vendorPricingVersion: 1, items: [{ id: 'offering_001', name: 'Premium Wash', type: 'SERVICE', unitPrice: 499, total: 499 }] }),
    };
    vehicles = { getVehicle: jest.fn().mockResolvedValue({ id: 'vehicle_001', userId: 'customer-1', vehicleType: 'SEDAN', brand: 'Honda', model: 'City', registrationNumber: 'KA01AB1234' }) };
    vendors = { getCheckoutEligibility: jest.fn().mockResolvedValue({ vendor: { vendorId: 'vendor_001', vendorName: 'Beauty Wheels', status: 'ACTIVE', operationalStatus: 'ONLINE', communityIds: ['community_001'] }, branch: { branchId: 'branch_001', branchName: 'Indiranagar', vendorId: 'vendor_001' } }) };
    availability = { consumeHold: jest.fn().mockResolvedValue(heldReservation), reserveBooking: jest.fn().mockResolvedValue({ slotId: 'internal-slot', date: '2026-10-25', startTime: '10:00', endTime: '10:45', timezone: 'Asia/Kolkata', durationMinutes: 45 }), releaseAllocation: jest.fn().mockResolvedValue(undefined) };
    users = { getProfile: jest.fn().mockResolvedValue({ communityIds: ['community_001'] }), assertAddress: jest.fn().mockResolvedValue(undefined) };
    service = new BookingsService(repository, catalog, vehicles, vendors, availability, users);
  });

  it('creates a PENDING_PAYMENT immutable snapshot after atomically reserving capacity', async () => {
    const result = await service.postbookings(request());
    expect(result).toMatchObject({ bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING', vendorName: 'Beauty Wheels', branchName: 'Indiranagar' });
    expect(result.schedule).toMatchObject({ date: '2026-10-25', startTime: '10:00', endTime: '10:45', durationMinutes: 45, startAtUtc: '2026-10-25T04:30:00.000Z' });
    expect(result.vehicleDetails).toMatchObject({ brand: 'Honda', model: 'City', registrationNumber: 'KA01AB1234' });
    expect(result.service).toMatchObject({ serviceId: 'offering_001', name: 'Premium Wash', durationMinutes: 45 });
    expect(result.pricingSnapshot).toMatchObject({ subtotalAmount: 499, totalAmount: 499, totalMinor: 499, currency: 'INR' });
    expect(availability.reserveBooking).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-25', startTime: '10:00', durationMinutes: 45 }));
  });

  it('rejects removed slot and version request fields at the boundary', async () => {
    await expect(service.postbookings(request({ ...command, slotId: 'slot', offeringVersion: 1 }))).rejects.toThrow();
    expect(availability.reserveBooking).not.toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
  });

  it('consumes a supplied hold instead of reserving and persists the holdId', async () => {
    const result = await service.postbookings(request({ ...command, holdId: ' hold-1 ' }));
    expect(availability.consumeHold).toHaveBeenCalledWith({ holdId: 'hold-1', bookingId: result.id, customerId: 'customer-1' });
    expect(availability.reserveBooking).not.toHaveBeenCalled();
    expect(result).toMatchObject({ holdId: 'hold-1', slotId: 'held-slot' });
    expect(result.schedule).toMatchObject({ date: '2026-10-25', startTime: '10:00', endTime: '12:00', durationMinutes: 120 });
    expect(repository.createBooking).toHaveBeenCalledWith(expect.objectContaining({ holdId: 'hold-1' }), expect.anything());
  });

  it('uses reserveBooking and stores no holdId when none is supplied', async () => {
    const result = await service.postbookings(request());
    expect(availability.reserveBooking).toHaveBeenCalled();
    expect(availability.consumeHold).not.toHaveBeenCalled();
    expect(result.holdId).toBeUndefined();
  });

  it('releases the consumed allocation when persisting a hold-backed booking fails', async () => {
    repository.createBooking.mockRejectedValue(new Error('dynamodb unavailable'));
    await expect(service.postbookings(request({ ...command, holdId: 'hold-1' }))).rejects.toThrow('dynamodb unavailable');
    expect(availability.releaseAllocation).toHaveBeenCalledWith(availability.consumeHold.mock.calls[0][0].bookingId);
  });

  it('propagates expired and consumed hold failures without creating a booking', async () => {
    availability.consumeHold.mockRejectedValue(new BookingError('HOLD_EXPIRED', 'Hold has expired', 409, 'holdId', false));
    await expect(service.postbookings(request({ ...command, holdId: 'hold-1' }))).rejects.toMatchObject({ code: 'HOLD_EXPIRED', statusCode: 409 });
    availability.consumeHold.mockRejectedValue(new BookingError('SLOT_UNAVAILABLE', 'Hold is already consumed', 409, 'holdId', false));
    await expect(service.postbookings(request({ ...command, holdId: 'hold-1' }))).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE', statusCode: 409 });
    expect(repository.createBooking).not.toHaveBeenCalled();
  });

  it('rejects and releases a hold that does not match the customer or request', async () => {
    availability.consumeHold.mockResolvedValue({ ...heldReservation, customerId: 'customer-2' });
    await expect(service.postbookings(request({ ...command, holdId: 'hold-1' }))).rejects.toMatchObject({ code: 'HOLD_NOT_OWNED', statusCode: 403 });
    availability.consumeHold.mockResolvedValue({ ...heldReservation, startTime: '11:00' });
    await expect(service.postbookings(request({ ...command, holdId: 'hold-1' }))).rejects.toMatchObject({ code: 'HOLD_MISMATCH', statusCode: 409 });
    availability.consumeHold.mockResolvedValue({ ...heldReservation, branchId: 'branch_002' });
    await expect(service.postbookings(request({ ...command, holdId: 'hold-1' }))).rejects.toMatchObject({ code: 'HOLD_MISMATCH' });
    expect(availability.releaseAllocation).toHaveBeenCalledTimes(3);
    expect(repository.createBooking).not.toHaveBeenCalled();
  });

  it('rejects price mismatches before reserving capacity', async () => {
    await expect(service.postbookings(request({ ...command, expectedPrice: { totalMinor: 1, currency: 'INR' } }))).rejects.toMatchObject({ code: 'PRICE_MISMATCH', statusCode: 409 });
    expect(availability.reserveBooking).not.toHaveBeenCalled();
  });

  it('snapshots validated add-ons from Catalog rather than client details', async () => {
    catalog.priceOffering.mockResolvedValue({ currency: 'INR', subtotal: 499, discount: 0, addOnTotal: 50, total: 549, unitPrice: 499, offeringVersion: 2, catalogVersion: 4, vendorPricingVersion: 1, items: [{ id: 'offering_001', name: 'Premium Wash', type: 'SERVICE', unitPrice: 499, total: 499 }, { id: 'wax', name: 'Wax', type: 'ADD_ON', unitPrice: 50, total: 50 }] });
    const result = await service.postbookings(request({ ...command, addOnIds: ['wax'], expectedPrice: { totalMinor: 549, currency: 'INR' } }));
    expect(result.addOns).toEqual([{ id: 'wax', name: 'Wax', price: 50, priceMinor: 50 }]);
    expect(catalog.priceOffering).toHaveBeenCalledWith(expect.objectContaining({ addOnIds: ['wax'] }));
  });

  it('returns the stored booking for an idempotent retry', async () => {
    const hash = requestFingerprint(validateCreateBooking(request()));
    repository.getIdempotency.mockResolvedValue({ PK: 'p', SK: 's', bookingId: 'booking-1', customerId: 'customer-1', requestHash: hash, entityType: 'BookingIdempotency' });
    repository.getBookingDetailsItem.mockResolvedValue({ id: 'booking-1', customerId: 'customer-1', bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING' } as any);
    await expect(service.postbookings(request())).resolves.toMatchObject({ id: 'booking-1' });
    expect(availability.reserveBooking).not.toHaveBeenCalled();
  });

  it('compensates a failed persistence write by releasing the internal reservation', async () => {
    repository.createBooking.mockRejectedValue(new Error('dynamodb unavailable'));
    await expect(service.postbookings(request())).rejects.toThrow('dynamodb unavailable');
    expect(availability.releaseAllocation).toHaveBeenCalled();
  });

  it('releases a losing reservation and returns the winning idempotent booking', async () => {
    const hash = requestFingerprint(validateCreateBooking(request()));
    repository.createBooking.mockRejectedValue(new ConditionalWriteConflictError('conflict'));
    repository.getIdempotency.mockResolvedValueOnce(null).mockResolvedValue({ PK: 'p', SK: 's', bookingId: 'booking-1', customerId: 'customer-1', requestHash: hash, entityType: 'BookingIdempotency' });
    repository.getBookingDetailsItem.mockResolvedValue({ id: 'booking-1', customerId: 'customer-1', bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING' } as any);
    await expect(service.postbookings(request())).resolves.toMatchObject({ id: 'booking-1' });
    expect(availability.releaseAllocation).toHaveBeenCalled();
  });
});
