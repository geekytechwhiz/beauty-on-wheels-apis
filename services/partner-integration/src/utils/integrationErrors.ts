/**
 * Custom errors for partner integration. Mapped to ApiResponse in handlers.
 * Never expose raw partner payloads or errors.
 */

export class PartnerUnavailableError extends Error {
  constructor(
    public readonly partnerId: string,
    message?: string
  ) {
    super(message ?? `Partner unavailable: ${partnerId}`);
    this.name = 'PartnerUnavailableError';
  }
}

export class UnsupportedPartnerError extends Error {
  constructor(
    public readonly partnerId: string,
    message?: string
  ) {
    super(message ?? `Unsupported partner: ${partnerId}`);
    this.name = 'UnsupportedPartnerError';
  }
}

export class InvalidPartnerResponseError extends Error {
  constructor(
    public readonly partnerId: string,
    message?: string
  ) {
    super(message ?? `Invalid response from partner: ${partnerId}`);
    this.name = 'InvalidPartnerResponseError';
  }
}
