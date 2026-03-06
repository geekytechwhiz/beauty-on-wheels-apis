export class OrganizationNotFoundError extends Error {
  statusCode = 404;
  code = 'ORGANIZATION_NOT_FOUND';
  constructor(organizationId: string) {
    super(`Organization not found: ${organizationId}`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class OrganizationAlreadyExistsError extends Error {
  statusCode = 409;
  code = 'ORGANIZATION_ALREADY_EXISTS';
  constructor(organizationId: string) {
    super(`Organization already exists: ${organizationId}`);
    this.name = 'OrganizationAlreadyExistsError';
  }
}

export class OrganizationValidationError extends Error {
  statusCode = 422;
  code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'OrganizationValidationError';
  }
}

export class PermissionDeniedError extends Error {
  statusCode = 403;
  code = 'PERMISSION_ISSUE';
  constructor(message = 'User does not have permission to link or unlink organizations') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class OrganizationNotActiveError extends Error {
  statusCode = 400;
  code = 'ORGANIZATION_MUST_ACTIVE';
  constructor(organizationId: string) {
    super(`Organization must be ACTIVE to be linked: ${organizationId}`);
    this.name = 'OrganizationNotActiveError';
  }
}

export class LinkedOrganizationsNotFoundError extends Error {
  statusCode = 404;
  code = 'LINKED_ORGANIZATIONS_NOT_FOUND';
  constructor(organizationId: string) {
    super(`No linked organizations found for: ${organizationId}`);
    this.name = 'LinkedOrganizationsNotFoundError';
  }
}
