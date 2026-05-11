import { BaseError } from '@api-hub/utils';

export class DuplicateEventError extends BaseError {
  constructor(eventId: string) {
    super(`Duplicate event detected: ${eventId}`, 409, 'DUPLICATE_EVENT');
  }
}
