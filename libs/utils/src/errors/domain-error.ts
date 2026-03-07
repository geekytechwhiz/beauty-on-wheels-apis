export class DomainError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(
    message: string,
    code: string,
    statusCode = 400,
    details?: unknown
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}