import { BaseError } from '@api-hub/utils';

export class RetryableError extends BaseError {
  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, 500, options?.code ?? 'RETRYABLE_ERROR', undefined, {
      retryable: true,
      metadata: options?.cause ? { cause: options.cause } : undefined,
    });
    this.name = 'RetryableError';
  }
}

export class NonRetryableError extends BaseError {
  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, 422, options?.code ?? 'NON_RETRYABLE_ERROR', undefined, {
      retryable: false,
      metadata: options?.cause ? { cause: options.cause } : undefined,
    });
    this.name = 'NonRetryableError';
  }
}

export class SchemaError extends NonRetryableError {
  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, options);
    this.name = 'SchemaError';
  }
}

export class DependencyError extends RetryableError {
  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, options);
    this.name = 'DependencyError';
  }
}
