export class PartnerNotFoundError extends Error {
  constructor(partnerId: string) {
    super(`Partner not found: ${partnerId}`);
    this.name = 'PartnerNotFoundError';
  }
}

export class PartnerAlreadyExistsError extends Error {
  constructor(partnerId: string) {
    super(`Partner already exists: ${partnerId}`);
    this.name = 'PartnerAlreadyExistsError';
  }
}

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization not found: ${organizationId}`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class OrgPartnerLinkExistsError extends Error {
  constructor(organizationId: string, partnerId: string) {
    super(`Organization ${organizationId} is already linked to partner ${partnerId}`);
    this.name = 'OrgPartnerLinkExistsError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
