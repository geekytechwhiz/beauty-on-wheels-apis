import { publishAvailabilityBookingReadiness } from '../events/publish-booking-readiness';
import { getAllocationsService } from '../services/allocations.service';
import { getHoldsService } from '../services/holds.service';
import { getSlotsService } from '../services/slots.service';

export const expireHolds = async (): Promise<{ expired: number; failed: number }> => {
  return getHoldsService().expireDue();
};

export const consumeHold = async (event: {
  holdId?: string;
  bookingId?: string;
  customerId?: string;
}): Promise<unknown> => {
  return getAllocationsService().consumeHold(event ?? {});
};

export const releaseAllocation = async (event: {
  bookingId?: string;
}): Promise<unknown> => {
  return getAllocationsService().releaseByBooking(event ?? {});
};

/** Same-account entry point used only after Booking validates the checkout request. */
export const reserveBooking = async (event: Parameters<ReturnType<typeof getAllocationsService>['reserveBooking']>[0]): Promise<unknown> => {
  return getAllocationsService().reserveBooking(event ?? {});
};

/** Same-account entry point. Catalog marketplace availability filter. */
export const findBookableOfferings = async (event: unknown): Promise<{ keys: string[] }> => {
  return getSlotsService().findBookableOfferings(event ?? {});
};

/** Reconciliation entry point. Commits and publishes the visit-schedule summary. */
export const getBookingReadinessFacts = async (event: { vendorId?: unknown; correlationId?: unknown } | null): Promise<unknown> => {
  const vendorId = typeof event?.vendorId === 'string' ? event.vendorId.trim() : '';
  if (!vendorId) return { error: { code: 'VALIDATION_ERROR', message: 'vendorId is required', statusCode: 400 } };
  const correlationId = typeof event?.correlationId === 'string' && event.correlationId.trim()
    ? event.correlationId.trim()
    : `availability-readiness-${vendorId}`;
  return { data: await publishAvailabilityBookingReadiness({ vendorId, correlationId }) };
};
