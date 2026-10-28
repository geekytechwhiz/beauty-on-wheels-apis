/**
 * Catalog offering type and lifecycle.
 * `offeringType` is a product/catalog code (SCREAMING_SNAKE).
 * Lifecycle status values are camelCase on the wire and in DynamoDB.
 */

import { BaseError } from '@api-hub/utils';

export const OFFERING_TYPE = {
  PACKAGE: 'PACKAGE',
  SERVICE: 'SERVICE',
} as const;

export type OfferingType = (typeof OFFERING_TYPE)[keyof typeof OFFERING_TYPE];

/** Currently supported create/update types. SERVICE is reserved for a future shape. */
export const SUPPORTED_OFFERING_TYPES = [OFFERING_TYPE.PACKAGE] as const;

export type SupportedOfferingType = (typeof SUPPORTED_OFFERING_TYPES)[number];

export const OFFERING_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
} as const;

export type OfferingLifecycleStatus =
  (typeof OFFERING_STATUS)[keyof typeof OFFERING_STATUS];

export const BILLING_PERIOD = {
  ONE_TIME: 'oneTime',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const;

export type BillingPeriod = (typeof BILLING_PERIOD)[keyof typeof BILLING_PERIOD];

export const DEFAULT_OFFERING_CURRENCY = 'INR';

/** Marketplace / booking eligibility: only published offerings are active. */
export function isOfferingDiscoverable(status: OfferingLifecycleStatus): boolean {
  return status === OFFERING_STATUS.PUBLISHED;
}

export function isOfferingArchived(status: OfferingLifecycleStatus): boolean {
  return status === OFFERING_STATUS.ARCHIVED;
}

/**
 * Allowed transitions. Archive is terminal for the public API
 * (DELETE maps to archived). Republish from paused is allowed.
 */
const TRANSITIONS: Record<OfferingLifecycleStatus, readonly OfferingLifecycleStatus[]> = {
  [OFFERING_STATUS.DRAFT]: [
    OFFERING_STATUS.PUBLISHED,
    OFFERING_STATUS.ARCHIVED,
  ],
  [OFFERING_STATUS.PUBLISHED]: [
    OFFERING_STATUS.PAUSED,
    OFFERING_STATUS.ARCHIVED,
    OFFERING_STATUS.DRAFT,
  ],
  [OFFERING_STATUS.PAUSED]: [
    OFFERING_STATUS.PUBLISHED,
    OFFERING_STATUS.ARCHIVED,
    OFFERING_STATUS.DRAFT,
  ],
  [OFFERING_STATUS.ARCHIVED]: [],
};

export function assertOfferingStatusTransition(
  from: OfferingLifecycleStatus,
  to: OfferingLifecycleStatus,
): void {
  if (from === to) {
    return;
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new BaseError(
      `Cannot transition offering from ${from} to ${to}`,
      409,
      'INVALID_OFFERING_STATUS_TRANSITION',
    );
  }
}
