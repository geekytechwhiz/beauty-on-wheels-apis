import { BaseError } from '@api-hub/utils';

export class AvailabilityError extends BaseError {
  constructor(code: string, message: string, statusCode: number) {
    super(message, statusCode, code, undefined, { retryable: false });
    this.name = 'AvailabilityError';
  }
}

export const AvailabilityErrors = {
  slotNotFound(): AvailabilityError {
    return new AvailabilityError('SLOT_NOT_FOUND', 'Slot not found', 404);
  },
  slotUnavailable(message = 'Slot is not bookable'): AvailabilityError {
    return new AvailabilityError('SLOT_UNAVAILABLE', message, 409);
  },
  slotBlocked(): AvailabilityError {
    return new AvailabilityError('SLOT_BLOCKED', 'Slot is blocked', 409);
  },
  holdNotFound(): AvailabilityError {
    return new AvailabilityError('HOLD_NOT_FOUND', 'Hold not found', 404);
  },
  holdExpired(): AvailabilityError {
    return new AvailabilityError('HOLD_EXPIRED', 'Hold has expired', 409);
  },
  holdAlreadyConsumed(): AvailabilityError {
    return new AvailabilityError(
      'HOLD_ALREADY_CONSUMED',
      'Hold is already consumed',
      409,
    );
  },
  capacityExceeded(): AvailabilityError {
    return new AvailabilityError(
      'CAPACITY_EXCEEDED',
      'Slot capacity has been exceeded',
      409,
    );
  },
  invalidDateRange(message = 'Date range is invalid'): AvailabilityError {
    return new AvailabilityError('INVALID_DATE_RANGE', message, 400);
  },
  vendorNotAvailable(message = 'Vendor is not available'): AvailabilityError {
    return new AvailabilityError('VENDOR_NOT_AVAILABLE', message, 409);
  },
  idempotencyConflict(): AvailabilityError {
    return new AvailabilityError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key is already used for a different request',
      409,
    );
  },
  holidayNotFound(): AvailabilityError {
    return new AvailabilityError('NOT_FOUND', 'Holiday not found', 404);
  },
};
