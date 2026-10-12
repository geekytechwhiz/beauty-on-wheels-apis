import { BaseError } from '@api-hub/utils';

export class BookingError extends BaseError {
  constructor(
    code: string,
    message: string,
    statusCode: number,
    field?: string,
    retryable = statusCode >= 500,
  ) {
    super(
      message,
      statusCode,
      code,
      field ? [{ field, message }] : undefined,
      { retryable },
    );
    this.name = 'BookingError';
  }
}
