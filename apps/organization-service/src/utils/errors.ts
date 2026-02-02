export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization not found: ${organizationId}`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class OrganizationAlreadyExistsError extends Error {
  constructor(organizationId: string) {
    super(`Organization already exists: ${organizationId}`);
    this.name = 'OrganizationAlreadyExistsError';
  }
}

export class OrganizationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrganizationValidationError';
  }
}

export class PermissionDeniedError extends Error {
  constructor(message = 'User does not have permission to link or unlink organizations') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class OrganizationNotActiveError extends Error {
  constructor(organizationId: string) {
    super(`Organization must be ACTIVE to be linked: ${organizationId}`);
    this.name = 'OrganizationNotActiveError';
  }
}

export class LinkedOrganizationsNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`No linked organizations found for: ${organizationId}`);
    this.name = 'LinkedOrganizationsNotFoundError';
  }
}
