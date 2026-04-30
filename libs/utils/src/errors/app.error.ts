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