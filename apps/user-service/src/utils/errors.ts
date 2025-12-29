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

