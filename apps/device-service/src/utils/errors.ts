export class DeviceNotFoundError extends Error {
  constructor(deviceId: string) {
    super(`Device not found: ${deviceId}`);
    this.name = 'DeviceNotFoundError';
  }
}

export class DeviceAlreadyPairedError extends Error {
  constructor(deviceId: string) {
    super(`Device already paired: ${deviceId}`);
    this.name = 'DeviceAlreadyPairedError';
  }
}

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization not found: ${organizationId}`);
    this.name = 'OrganizationNotFoundError';
  }
}

export class InvalidOrganizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOrganizationError';
  }
}

export class DeviceNotInOrganizationError extends Error {
  constructor(deviceId: string, organizationId: string) {
    super(`Device ${deviceId} is not available in organization ${organizationId}`);
    this.name = 'DeviceNotInOrganizationError';
  }
}

export class RecommendationNotFoundError extends Error {
  constructor(patientUserId: string, deviceId: string) {
    super(`Recommendation not found for patient ${patientUserId} and device ${deviceId}`);
    this.name = 'RecommendationNotFoundError';
  }
}

export class RecommendationAlreadyExistsError extends Error {
  constructor(patientUserId: string, deviceId: string) {
    super(`Recommendation already exists for patient ${patientUserId} and device ${deviceId}`);
    this.name = 'RecommendationAlreadyExistsError';
  }
}

export class RecommendationCannotRemovePairedError extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} is already paired and cannot be removed from recommendations`);
    this.name = 'RecommendationCannotRemovePairedError';
  }
}
