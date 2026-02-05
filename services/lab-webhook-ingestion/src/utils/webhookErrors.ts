export class InvalidSignatureError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

export class UnknownPartnerError extends Error {
  constructor(partnerId: string) {
    super(`Unknown partner: ${partnerId}`);
    this.name = 'UnknownPartnerError';
  }
}

export class DuplicateEventError extends Error {
  constructor(eventId: string) {
    super(`Duplicate event: ${eventId}`);
    this.name = 'DuplicateEventError';
  }
}

export class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPayloadError';
  }
}
