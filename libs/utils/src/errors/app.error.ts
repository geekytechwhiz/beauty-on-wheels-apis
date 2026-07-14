import { BaseError, BaseErrorOptions } from "./base.error";

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

export class ValidationError extends BaseError {
  constructor(message: string, details?: any[], options?: BaseErrorOptions) {
    super(message, 400, "VALIDATION_ERROR", details, options);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConflictError extends BaseError {
  constructor(message: string, details?: any[], options?: BaseErrorOptions) {
    super(message, 409, "CONFLICT", details, options);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends BaseError {
  constructor(message: string, details?: any[], options?: BaseErrorOptions) {
    super(message, 404, "NOT_FOUND", details, options);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends BaseError {
  constructor(message: string, details?: any[], options?: BaseErrorOptions) {
    super(message, 401, "UNAUTHORIZED", details, options);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ForbiddenError extends BaseError {
  constructor(message: string, details?: any[], options?: BaseErrorOptions) {
    super(message, 403, "FORBIDDEN", details, options);
    this.name = "ForbiddenError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BusinessRuleError extends BaseError {
  constructor(message: string, details?: any[], options?: BaseErrorOptions) {
    super(message, 422, "BUSINESS_RULE_ERROR", details, options);
    this.name = "BusinessRuleError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}