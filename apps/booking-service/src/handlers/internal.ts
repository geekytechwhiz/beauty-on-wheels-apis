import { BaseError } from '@api-hub/utils';

import { getBookingsService } from '../services/bookings.service';

/**
 * Same-account Lambda entry point. It has no HTTP event and must only be
 * invoked by the payment workflow after a gateway signature has been checked.
 */
export const confirmPaidBooking = async (event: {
  bookingId?: unknown;
  amount?: unknown;
  currency?: unknown;
} | null): Promise<unknown> => {
  try {
    const data = await getBookingsService().confirmPaidBooking(event ?? {});
    return { data };
  } catch (error) {
    if (error instanceof BaseError) {
      return {
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
        },
      };
    }
    throw error;
  }
};

/** Trusted Payment Service callback for gateway failure or payment expiry. */
export const failPaymentBooking = async (event: { bookingId?: unknown } | null): Promise<unknown> => {
  try {
    const data = await getBookingsService().failPaymentBooking(event ?? {});
    return { data };
  } catch (error) {
    if (error instanceof BaseError) {
      return { error: { code: error.code, message: error.message, statusCode: error.statusCode } };
    }
    throw error;
  }
};
