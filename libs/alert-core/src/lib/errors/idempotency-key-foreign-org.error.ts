import { BaseError } from '@api-hub/utils';

/**
 * Same idempotency key already used under another organization; must not surface another tenant’s alert.
 */
export class IdempotencyKeyForeignOrgError extends BaseError {
  constructor() {
    super(
      'This idempotency key is already in use',
      409,
      'IDEMPOTENCY_KEY_IN_USE',
    );
  }
}
