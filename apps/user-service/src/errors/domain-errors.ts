/**
 * Domain error hierarchy for user-service.
 * Use these in services/repositories; BaseHandler maps them to HTTP responses.
 */

/** Format decimal hours into whole hours and minutes (for consistent "pending time" display) */
export function formatPendingTime(pendingHoursDecimal: number): {
  hours: number;
  minutes: number;
  formatted: string;
} {
  const hours = Math.floor(pendingHoursDecimal);
  const minutes = Math.round((pendingHoursDecimal - hours) * 60);
  const formatted =
    hours > 0 && minutes > 0
      ? `${hours} hour${hours !== 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`
      : hours > 0
        ? `${hours} hour${hours !== 1 ? 's' : ''}`
        : `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return { hours, minutes, formatted };
}

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
  /** Whole hours until resend is allowed (same format as display) */
  public readonly pendingHours: number;
  /** Whole minutes in addition to pendingHours */
  public readonly pendingMinutes: number;
  /** Human-readable e.g. "23 hours and 56 minutes" */
  public readonly pendingTimeFormatted: string;

  constructor(field: 'email' | 'sms', lastUpdatedAt: string, hoursSinceUpdate: number) {
    const pendingHoursDecimal = Math.max(0, 24 - hoursSinceUpdate);
    const pending = formatPendingTime(pendingHoursDecimal);
    super(
      `Invite sent recently. You can resend it after ${pending.formatted}.`,
      'INVITE_UPDATE_TOO_SOON',
      429,
    );
    this.name = 'InviteUpdateTooSoonError';
    this.field = field;
    this.lastUpdatedAt = lastUpdatedAt;
    this.hoursSinceUpdate = hoursSinceUpdate;
    this.pendingHours = pending.hours;
    this.pendingMinutes = pending.minutes;
    this.pendingTimeFormatted = pending.formatted;
  }
}

// ─── Organisation ─────────────────────────────────────────────────────────────

export class OrganizationNotExistError extends DomainError {
  constructor() {
    super('Organization does not exist', 'ORGANIZATION_NOT_EXIST', 404);
    this.name = 'OrganizationNotExistError';
  }
}

export class OrganizationOnHoldError extends DomainError {
  constructor() {
    super('Organization is on hold', 'ORGANIZATION_IS_ON_HOLD', 400);
    this.name = 'OrganizationOnHoldError';
  }
}

export class OrganizationMismatchError extends DomainError {
  constructor() {
    super('Organization mismatch', 'ORGANIZATION_MISMATCH', 400);
    this.name = 'OrganizationMismatchError';
  }
}

// ─── Friend & Family ──────────────────────────────────────────────────────────

export class EmailOrPhoneRequiredError extends DomainError {
  constructor() {
    super('Email or phone is required', 'EMAIL_OR_PHONE_REQUIRED', 400);
    this.name = 'EmailOrPhoneRequiredError';
  }
}

export class FnfLimitReachedError extends DomainError {
  constructor() {
    super('Friend & family limit reached', 'USER_CANNOT_INVITE_MORE_FNF', 409);
    this.name = 'FnfLimitReachedError';
  }
}

export class UserAlreadyInvitedError extends DomainError {
  constructor() {
    super('User already invited', 'USER_ALREADY_INVITED', 409);
    this.name = 'UserAlreadyInvitedError';
  }
}

export class UserAlreadyInvitedBySomeoneError extends DomainError {
  constructor() {
    super('User already invited by someone', 'USER_ALREADY_INVITED_BY_SOMEONE', 409);
    this.name = 'UserAlreadyInvitedBySomeoneError';
  }
}

export class UserAlreadyAddedAsFnfError extends DomainError {
  constructor() {
    super('User already added as friend or family', 'USER_ALREADY_ADDED_AS_FNF', 409);
    this.name = 'UserAlreadyAddedAsFnfError';
  }
}

export class MemberNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Member not found: ${id}`, 'MEMBER_NOT_FOUND', 404);
    this.name = 'MemberNotFoundError';
  }
}

export class FnfDoesNotExistError extends DomainError {
  constructor() {
    super('Friend & family link not found', 'FNF_DOES_NOT_EXIST', 404);
    this.name = 'FnfDoesNotExistError';
  }
}