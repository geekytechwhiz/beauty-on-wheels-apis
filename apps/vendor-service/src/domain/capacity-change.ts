import { BaseError } from '@api-hub/utils';

import {
  CAPACITY_COMMITMENT_STATUS,
  CapacityCommitmentDdbItem,
  CapacityCommitmentStatus,
} from './capacity-commitment';

/**
 * Attributes this feature adds to a CapacityCommitment row. They are optional so rows
 * written by the capacity-proposals accept path stay valid.
 */
export type ChangeAwareCommitment = CapacityCommitmentDdbItem & {
  pendingChangeRequestId?: string;
  previousQuantity?: number;
  lastChangeRequestId?: string;
  /** Set when an approved reduction chose BLOCK_SALES. Selling code must honour it. */
  salesBlocked?: boolean;
};

export const CAPACITY_CHANGE_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type CapacityChangeStatus =
  (typeof CAPACITY_CHANGE_STATUS)[keyof typeof CAPACITY_CHANGE_STATUS];

export const COVERAGE_DECISIONS = ['COVERED_ELSEWHERE', 'BLOCK_SALES', 'REJECT'] as const;
export type CoverageDecision = (typeof COVERAGE_DECISIONS)[number];

export interface ReplacementCoverageDecision {
  decision: CoverageDecision;
  note?: string;
}

export interface CapacityChangeHistoryEntry {
  at: string;
  actorId: string;
  actorRole: 'VENDOR' | 'ADMIN';
  action: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  note?: string;
}

/** Commitment statuses a change request may start from. */
export const CHANGEABLE_COMMITMENT_STATUSES: readonly CapacityCommitmentStatus[] = [
  CAPACITY_COMMITMENT_STATUS.ACTIVE,
  CAPACITY_COMMITMENT_STATUS.REDUCED,
];

export interface CapacityChangeRequestDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  requestId: string;
  vendorId: string;
  commitmentId: string;
  /** Commitment quantity when the request was filed. */
  currentQuantity: number;
  requestedQuantity: number;
  reason: string;
  status: CapacityChangeStatus;
  /** Restored onto the commitment if the request is rejected. */
  commitmentStatusBefore: CapacityCommitmentStatus;
  createdBy: string;
  replacementCoverageDecision?: ReplacementCoverageDecision;
  /** Sold quantity read when the decision was made. */
  soldQuantityAtDecision?: number;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  history: CapacityChangeHistoryEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
  entityType: 'CapacityChangeRequest';
}

export type CapacityChangeRequestResponse = Omit<
  CapacityChangeRequestDdbItem,
  'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'entityType' | 'version'
>;

export const capacityChangeKeys = {
  pk: (vendorId: string) => `VENDOR#${vendorId}`,
  sk: (requestId: string) => `CAPACITY_CHANGE#${requestId}`,
  skPrefix: () => 'CAPACITY_CHANGE#',
  lookupPk: (requestId: string) => `CAPACITY_CHANGE#${requestId}`,
  lookupSk: () => 'LOOKUP',
  gsi1Pk: () => 'CAPACITY_CHANGE',
  gsi1Sk: (status: string, createdAt: string, requestId: string) => `STATUS#${status}#${createdAt}#${requestId}`,
  idempotencyPk: (vendorId: string, key: string) => `IDEMPOTENCY#CAPACITY_CHANGE#${vendorId}#${key}`,
  idempotencySk: () => 'RECORD',
};

export function toChangeResponse(item: CapacityChangeRequestDdbItem): CapacityChangeRequestResponse {
  const {
    PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, entityType: _type, version: _version,
    ...response
  } = item;
  return response;
}

export interface ApprovalOutcome {
  newQuantity: number;
  newStatus: CapacityCommitmentStatus;
  /** True when the admin chose BLOCK_SALES to stop selling against a reduced commitment. */
  salesBlocked: boolean;
  decision?: ReplacementCoverageDecision;
}

function refusal(code: string, message: string): BaseError {
  return new BaseError(message, 409, code, [{ field: 'replacementCoverageDecision', message }], { retryable: false });
}

/**
 * Obligation check for approving a change. Never reduces silently:
 * when the new quantity is below what is already sold, an explicit
 * replacementCoverageDecision of COVERED_ELSEWHERE or BLOCK_SALES is required.
 * REJECT is never an approval; the admin must call the reject route instead.
 */
export function evaluateApproval(input: {
  currentQuantity: number;
  requestedQuantity: number;
  reservedSoldQuantity: number;
  decision?: ReplacementCoverageDecision;
}): ApprovalOutcome {
  const { currentQuantity, requestedQuantity, reservedSoldQuantity, decision } = input;
  if (decision?.decision === 'REJECT') {
    throw refusal(
      'REPLACEMENT_COVERAGE_REJECTED',
      'Decision REJECT refuses the reduction. Use the reject route to close this request.',
    );
  }
  const belowSold = reservedSoldQuantity > requestedQuantity;
  if (belowSold && !decision) {
    throw refusal(
      'REPLACEMENT_COVERAGE_REQUIRED',
      `${reservedSoldQuantity} already sold exceeds the requested ${requestedQuantity}. `
      + 'Provide replacementCoverageDecision COVERED_ELSEWHERE or BLOCK_SALES, or reject the request.',
    );
  }
  return {
    newQuantity: requestedQuantity,
    newStatus: requestedQuantity < currentQuantity
      ? CAPACITY_COMMITMENT_STATUS.REDUCED
      : CAPACITY_COMMITMENT_STATUS.ACTIVE,
    salesBlocked: belowSold && decision?.decision === 'BLOCK_SALES',
    ...(belowSold && decision ? { decision } : {}),
  };
}
