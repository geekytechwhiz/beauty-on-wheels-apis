/** HTTP-oriented fields for compatibility with @api-hub/utils handleError / withLambdaHandler. */
export class MetadataNotFoundError extends Error {
  readonly statusCode = 404 as const;
  readonly code = 'RESOURCE_NOT_FOUND';

  constructor(readonly resource: string, readonly id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'MetadataNotFoundError';
  }
}

export class MetadataConflictError extends Error {
  readonly statusCode = 409 as const;
  readonly code = 'CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'MetadataConflictError';
  }
}

export class MetadataValidationError extends Error {
  readonly statusCode = 400 as const;
  readonly code = 'VALIDATION_ERROR';
  readonly details: Array<{ field?: string; message: string }>;

  constructor(
    message: string,
    details?: Array<{ field?: string; message: string }>,
  ) {
    super(message);
    this.name = 'MetadataValidationError';
    this.details = details ?? [{ message }];
  }
}
