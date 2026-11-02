import { BaseError, ValidationError } from '@api-hub/utils';

export const ADDON_SUGGESTION_STATUS = {
  PENDING_REVIEW: 'pendingReview',
  CHANGES_REQUESTED: 'changesRequested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type AddonSuggestionStatus =
  (typeof ADDON_SUGGESTION_STATUS)[keyof typeof ADDON_SUGGESTION_STATUS];

export const ADDON_SUGGESTION_REVIEW_ACTION = {
  REQUEST_CHANGES: 'requestChanges',
  APPROVE: 'approve',
  REJECT: 'reject',
} as const;

export type AddonSuggestionReviewAction =
  (typeof ADDON_SUGGESTION_REVIEW_ACTION)[keyof typeof ADDON_SUGGESTION_REVIEW_ACTION];

export interface AddonSuggestionHistoryEntry {
  at: string;
  actorId: string;
  actorRole: 'VENDOR' | 'ADMIN';
  action: 'SUBMITTED' | 'REQUEST_CHANGES' | 'APPROVED' | 'REJECTED';
  note?: string;
}

export interface AddonSuggestionEntity {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'AddonSuggestion';
  suggestionId: string;
  vendorId: string;
  categoryId: string;
  serviceId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  proposedCustomerPriceMinor?: number;
  packageCompatibilityNotes?: string;
  status: AddonSuggestionStatus;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  /** Set when Carish publishes via admin add-on path; not auto-filled on approve. */
  publishedAddonId?: string;
  history: AddonSuggestionHistoryEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AddonSuggestionLookupEntity {
  PK: string;
  SK: string;
  vendorId: string;
  entityType: 'AddonSuggestionLookup';
}

export interface AddonSuggestionIdempotencyEntity {
  PK: string;
  SK: string;
  entityType: 'AddonSuggestionIdempotency';
  requestHash: string;
  suggestionId: string;
  vendorId: string;
}

export interface AddonSuggestionReviewIdempotencyEntity {
  PK: string;
  SK: string;
  entityType: 'AddonSuggestionReviewIdempotency';
  requestHash: string;
  suggestionId: string;
  responseSnapshot: Record<string, unknown>;
}

export type AddonSuggestionResponse = Omit<
  AddonSuggestionEntity,
  'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'entityType' | 'version'
>;

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}$/;

export const addonSuggestionKeys = {
  pk: (vendorId: string) => `VENDOR#${vendorId}`,
  sk: (suggestionId: string) => `ADDON_SUGGESTION#${suggestionId}`,
  skPrefix: () => 'ADDON_SUGGESTION#',
  lookupPk: (suggestionId: string) => `ADDON_SUGGESTION#${suggestionId}`,
  lookupSk: () => 'LOOKUP',
  gsi1Pk: () => 'ADDON_SUGGESTION',
  gsi1Sk: (status: AddonSuggestionStatus, createdAt: string, suggestionId: string) =>
    `STATUS#${status}#${createdAt}#${suggestionId}`,
  createIdempotencySk: (key: string) => `IDEMPOTENCY#ADDON_SUGGESTION#${key}`,
  reviewIdempotencySk: (key: string) => `IDEMPOTENCY#ADDON_SUGGESTION_REVIEW#${key}`,
};

export function readIdempotencyKey(headers: Record<string, unknown> | undefined): string {
  if (!headers) {
    throw new ValidationError('Idempotency-Key header is required');
  }
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'idempotency-key');
  if (!entry || typeof entry[1] !== 'string' || !entry[1].trim()) {
    throw new ValidationError('Idempotency-Key header is required');
  }
  const key = entry[1].trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new ValidationError('Idempotency-Key header is required');
  }
  return key;
}

export function toAddonSuggestionResponse(item: AddonSuggestionEntity): AddonSuggestionResponse {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _g1pk,
    GSI1SK: _g1sk,
    entityType: _type,
    version: _version,
    ...rest
  } = item;
  return rest;
}

export function statusForReviewAction(action: AddonSuggestionReviewAction): AddonSuggestionStatus {
  switch (action) {
    case ADDON_SUGGESTION_REVIEW_ACTION.REQUEST_CHANGES:
      return ADDON_SUGGESTION_STATUS.CHANGES_REQUESTED;
    case ADDON_SUGGESTION_REVIEW_ACTION.APPROVE:
      return ADDON_SUGGESTION_STATUS.APPROVED;
    case ADDON_SUGGESTION_REVIEW_ACTION.REJECT:
      return ADDON_SUGGESTION_STATUS.REJECTED;
    default:
      throw new ValidationError('Invalid review action');
  }
}

export function assertReviewable(status: AddonSuggestionStatus): void {
  if (
    status === ADDON_SUGGESTION_STATUS.PENDING_REVIEW
    || status === ADDON_SUGGESTION_STATUS.CHANGES_REQUESTED
  ) {
    return;
  }
  throw new BaseError(
    `Suggestion is already ${status}`,
    409,
    'SUGGESTION_NOT_REVIEWABLE',
    undefined,
    { retryable: false },
  );
}
