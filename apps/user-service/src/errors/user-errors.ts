import { DomainError } from "@api-hub/utils";

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
    public override readonly details?: Array<{ field?: string; message: string }>,
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

export class RoleNotFoundError extends DomainError {
  constructor(roleId: string) {
    super(`Role not found: ${roleId}`, 'ROLE_NOT_FOUND', 404);
    this.name = 'RoleNotFoundError';
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

export class OrganizationNotAvailableError extends DomainError {
  constructor(organizationId: string) {
    super(`Organization is not available: ${organizationId}`, 'ORGANIZATION_NOT_AVAILABLE', 400);
    this.name = 'OrganizationNotAvailableError';
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
