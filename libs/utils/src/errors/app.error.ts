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

  export class ConditionalWriteConflictError extends Error {
    constructor(cause: unknown) {
      super("Conditional write failed (possible duplicate)");
      this.name = "ConditionalWriteConflictError";
      this.cause = cause;
    }
  }