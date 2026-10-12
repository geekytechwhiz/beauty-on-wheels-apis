import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { BookingsRepository } from './bookings.repository';
import { BookingsMapper } from '../mappers/bookings.mapper';
import { Booking } from '../types/api-types';
import { BookingDdbItem } from '../types/repository.types';

class CapturingRepository extends BookingsRepository {
  public written: TransactWriteCommandInput | undefined;

  protected override async transactWrite(params: TransactWriteCommandInput): Promise<void> {
    this.written = params;
  }
}

const snapshot = {
  offeringId: 'offering_001',
  offeringVersion: 2,
  baseAmount: 499,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 499,
  currency: 'INR',
};

const booking: Booking = {
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
  location: { fulfilmentType: 'community', communityId: 'community_001' },
  pricingSnapshot: snapshot,
  quoteId: 'historical-quote',
  totalAmount: 499,
  paymentStatus: 'PENDING',
  bookingStatus: 'PENDING',
};

describe('BookingsRepository create', () => {
  it('persists the pricing snapshot and does not write a slot reservation', async () => {
    const repository = new CapturingRepository();
    const created = await repository.createBooking(booking, {
      idempotencyKey: 'idem-1',
      requestHash: 'hash-1',
    });

    expect(created.pricingSnapshot).toEqual(snapshot);
    const items = repository.written?.TransactItems ?? [];
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('SLOT_RESERVATION');
    expect(serialized).toContain('HOLD_BOOKING#hold_001');
    expect(serialized).toContain('IDEMPOTENCY#customer-1#idem-1');
    const details = items[0]?.Put?.Item as Record<string, unknown> | undefined;
    expect(details?.pricingSnapshot).toEqual(snapshot);
    expect(details?.quoteId).toBe('historical-quote');
    expect(details?.totalAmount).toBe(499);
  });

  it('returns the stored snapshot from a historical item', () => {
    const item = BookingsMapper.toDdbItem(booking, 1, '2026-10-12T00:00:00.000Z');
    const domain = BookingsMapper.toDomain(item as BookingDdbItem);
    expect(domain.pricingSnapshot).toEqual(snapshot);
    expect(domain.quoteId).toBe('historical-quote');
  });
});
