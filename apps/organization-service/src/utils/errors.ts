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
