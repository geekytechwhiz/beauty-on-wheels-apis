import { getAllocationsService } from '../services/allocations.service';
import { getHoldsService } from '../services/holds.service';
import { getSlotsService } from '../services/slots.service';

export const expireHolds = async (): Promise<{ expired: number; failed: number }> => {
  return getHoldsService().expireDue();
};

export const consumeHold = async (event: {
  holdId?: string;
  bookingId?: string;
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
