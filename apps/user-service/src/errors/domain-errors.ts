/**
 * Domain error hierarchy for user-service.
 * Use these in services/repositories; BaseHandler maps them to HTTP responses.
 */

/** Base for all domain errors; optional statusCode for HTTP mapping */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Generic not-found (subclass for specific resources to preserve instanceof checks) */
export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, `${resource.toUpperCase()}_NOT_FOUND`, 404);
  }
}

/** Generic conflict (e.g. duplicate resource) */
export class ConflictError extends DomainError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, code, 409);
  }
}

/** Validation failed (422) */
export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly details?: Array<{ field?: string; message: string }>,
  ) {
    super(message, 'VALIDATION_ERROR', 422);
  }
}

/** Downstream service (e.g. Cognito, Org API) failed */
export class DownstreamServiceError extends DomainError {
  constructor(service: string, public override readonly cause?: Error) {
    super(`Downstream service error: ${service}`, 'DOWNSTREAM_ERROR', 502);
  }
}

// --- Backward-compatible concrete errors (same names/signatures as utils/errors.ts) ---

export class UserNotFoundError extends DomainError {
  constructor(userId: string) {
    super(`User not found: ${userId}`, 'USER_NOT_FOUND', 404);
    this.name = 'UserNotFoundError';
  }
}

export class UserAlreadyExistsError extends DomainError {
  constructor(userId: string) {
    super(`User already exists: ${userId}`, 'USER_ALREADY_EXISTS', 409);
    this.name = 'UserAlreadyExistsError';
  }
}

export class OrganizationNotFoundError extends DomainError {
  constructor(organizationId: string) {
    super(`Organization not found: ${organizationId}`, 'ORGANIZATION_NOT_FOUND', 400);
    this.name = 'OrganizationNotFoundError';
  }
}

export class InvalidEventError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_EVENT', 400);
    this.name = 'InvalidEventError';
  }
}

export class InviteUpdateTooSoonError extends DomainError {
  public readonly field: 'email' | 'sms';
  public readonly lastUpdatedAt: string;
  public readonly hoursSinceUpdate: number;

  constructor(field: 'email' | 'sms', lastUpdatedAt: string, hoursSinceUpdate: number) {
    const fieldName = field.toUpperCase();
    super(
      `${fieldName} invite was updated less than 24 hours ago. Last updated: ${lastUpdatedAt}. Hours since update: ${hoursSinceUpdate.toFixed(2)}`,
      'INVITE_UPDATE_TOO_SOON',
      429,
    );
    this.name = 'InviteUpdateTooSoonError';
    this.field = field;
    this.lastUpdatedAt = lastUpdatedAt;
    this.hoursSinceUpdate = hoursSinceUpdate;
  }
}
