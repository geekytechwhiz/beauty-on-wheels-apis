import { BaseError } from '@api-hub/utils';

export class MetadataRegistryError extends BaseError {
  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: { field?: string; message: string }[],
  ) {
    super(message, statusCode, code, details);
    this.name = 'MetadataRegistryError';
  }
}

export class ValidationError extends MetadataRegistryError {
  constructor(message: string, details?: { field?: string; message: string }[]) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends MetadataRegistryError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(message, 404, code);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends MetadataRegistryError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
    this.name = 'ConflictError';
  }
}
