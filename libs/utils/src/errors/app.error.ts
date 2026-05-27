export interface AppError extends Error {
    statusCode?: number;
    code?: string;
    details?: {
      code?: string;
      field?: string;
      message: string;
    }[];
    /** When false, consumers must not retry (e.g. validation). When true, safe to retry (e.g. transient upstream). */
    retryable?: boolean;
    metadata?: Record<string, unknown>;
  }

export type TransactCancellationReason = {
  Code?: string;
  Message?: string;
};

export type ConditionalWriteConflictErrorOptions = {
  cancellationReasons?: readonly TransactCancellationReason[];
  /** Populated when the failure originated from `TransactWriteItems`. */
  failedTransactItemIndexes?: readonly number[];
};

export class ConditionalWriteConflictError extends Error {
  readonly cancellationReasons?: readonly TransactCancellationReason[];
  readonly failedTransactItemIndexes?: readonly number[];

  constructor(cause: unknown, options?: ConditionalWriteConflictErrorOptions) {
    super("Conditional write failed (possible duplicate)");
    this.name = "ConditionalWriteConflictError";
    this.cause = cause;
    this.cancellationReasons = options?.cancellationReasons;
    this.failedTransactItemIndexes = options?.failedTransactItemIndexes;
  }
}