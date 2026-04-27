import { AppError } from './app.error';

export class BaseError extends Error implements AppError {

  statusCode: number;
  code: string;
  details?: {
    code?: string;
    field?: string;
    message: string;
  }[];

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: {
      code?: string;
      field?: string;
      message: string;
    }[]
  ) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}