export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

export class UserAlreadyExistsError extends Error {
  constructor(userId: string) {
    super(`User already exists: ${userId}`);
    this.name = 'UserAlreadyExistsError';
  }
}

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization not found: ${organizationId}`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventError';
  }
}

export class InviteUpdateTooSoonError extends Error {
  public readonly field: 'email' | 'sms';
  public readonly lastUpdatedAt: string;
  public readonly hoursSinceUpdate: number;

  constructor(field: 'email' | 'sms', lastUpdatedAt: string, hoursSinceUpdate: number) {
    const fieldName = field.toUpperCase();
    super(
      `${fieldName} invite was updated less than 24 hours ago. Last updated: ${lastUpdatedAt}. Hours since update: ${hoursSinceUpdate.toFixed(2)}`
    );
    this.name = 'InviteUpdateTooSoonError';
    this.field = field;
    this.lastUpdatedAt = lastUpdatedAt;
    this.hoursSinceUpdate = hoursSinceUpdate;
  }
}
