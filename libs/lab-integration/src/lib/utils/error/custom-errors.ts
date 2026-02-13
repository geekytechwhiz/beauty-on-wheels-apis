/**
 * Custom error classes for lab integration.
 */
export class InvalidPartnerResponseError extends Error {
  constructor(
    public readonly partnerId: string,
    message: string,
    public readonly statusCode?: number,
    public readonly responseData?: unknown
  ) {
    super(`[${partnerId}] ${message}`);
    this.name = 'InvalidPartnerResponseError';
  }
}

export class PartnerUnavailableError extends Error {
  constructor(
    public readonly partnerId: string,
    message: string,
    public override readonly cause?: Error
  ) {
    super(`[${partnerId}] Partner service unavailable: ${message}`);
    this.name = 'PartnerUnavailableError';
  }
}

export class PartnerAuthenticationError extends Error {
  constructor(
    public readonly partnerId: string,
    message: string = 'Authentication failed'
  ) {
    super(`[${partnerId}] ${message}`);
    this.name = 'PartnerAuthenticationError';
  }
}

export class PartnerNotFoundError extends Error {
  constructor(
    public readonly partnerId: string,
    public readonly resourceId: string
  ) {
    super(`[${partnerId}] Resource not found: ${resourceId}`);
    this.name = 'PartnerNotFoundError';
  }
}
