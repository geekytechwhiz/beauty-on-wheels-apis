import { AppError } from './app.error';

export type BaseErrorOptions = {
  retryable?: boolean;
  metadata?: Record<string, unknown>;
};

export class BaseError extends Error implements AppError {

  statusCode: number;
  code: string;
  details?: {
    code?: string;
    field?: string;
    message: string;
  }[];
  retryable?: boolean;
  metadata?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: {
      code?: string;
      field?: string;
      message: string;
    }[],
    options?: BaseErrorOptions,
  ) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryable = options?.retryable;
    this.metadata = options?.metadata;
  }
}