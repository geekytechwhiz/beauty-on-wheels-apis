import { BaseError } from '@api-hub/utils';

export class DocumentStorageError extends BaseError {
  constructor(message: string) {
    super(message, 502, 'DOCUMENT_STORAGE_ERROR', undefined, { retryable: true });
    this.name = 'DocumentStorageError';
  }
}

export class BadRequestError extends BaseError {
  constructor(
    message: string,
    details?: {
      code?: string;
      field?: string;
      message: string;
    }[],
  ) {
    super(message, 400, 'BAD_REQUEST', details, { retryable: false });
    this.name = 'BadRequestError';
  }
}

export class RateLimitError extends BaseError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED', undefined, { retryable: true });
    this.name = 'RateLimitError';
  }
}
