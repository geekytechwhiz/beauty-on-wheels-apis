import { getAllocationsService } from '../services/allocations.service';
import { getHoldsService } from '../services/holds.service';

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
