import { createHash } from 'crypto';

import { ConflictError, ValidationError } from '@api-hub/utils';

import type { PackageScope, PayoutRate, ServiceWindow } from './capacity-commitment';

export const CAPACITY_PROPOSAL_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  COUNTERED: 'COUNTERED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED',
} as const;

export type CapacityProposalStatus =
  (typeof CAPACITY_PROPOSAL_STATUS)[keyof typeof CAPACITY_PROPOSAL_STATUS];

export const CAPACITY_PROPOSAL_STATUS_VALUES = Object.values(
  CAPACITY_PROPOSAL_STATUS,
) as [CapacityProposalStatus, ...CapacityProposalStatus[]];

export const PROPOSAL_ACTOR_ROLE = {
  ADMIN: 'ADMIN',
  VENDOR: 'VENDOR',
  SYSTEM: 'SYSTEM',
} as const;

export type ProposalActorRole =
  (typeof PROPOSAL_ACTOR_ROLE)[keyof typeof PROPOSAL_ACTOR_ROLE];

export const PROPOSAL_ACTION = {
  CREATE: 'CREATE',
  SEND: 'SEND',
  ACCEPT: 'ACCEPT',
  COUNTER: 'COUNTER',
  ACCEPT_COUNTER: 'ACCEPT_COUNTER',
  REVISE: 'REVISE',
  DECLINE: 'DECLINE',
  EXPIRE: 'EXPIRE',
  CANCEL: 'CANCEL',
} as const;

export type ProposalAction = (typeof PROPOSAL_ACTION)[keyof typeof PROPOSAL_ACTION];

export const MAX_PROPOSAL_HISTORY = 100;

export interface CapacityProposalHistoryEntry {
  at: string;
  actorId: string;
  actorRole: ProposalActorRole;
  action: ProposalAction;
  fromStatus?: CapacityProposalStatus;
  toStatus?: CapacityProposalStatus;
  note?: string;
}

export interface ProposalCounter {
  quantity: number;
  payoutRate: PayoutRate;
  note?: string;
  counteredAt: string;
  counteredBy: string;
  /** The offer being countered. */
  previousQuantity: number;
  previousPayoutRate: PayoutRate;
}

export interface CapacityProposalDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI3PK: string;
  GSI3SK: string;
  proposalId: string;
  vendorId: string;
  communityId: string;
  packageScope: PackageScope;
  serviceWindow: ServiceWindow;
  /** Visit-slots per service-window day. See capacity-commitment.ts. */
  quantity: number;
  responseDeadline: string;
  proposedPayoutRate: PayoutRate;
  status: CapacityProposalStatus;
  history: CapacityProposalHistoryEntry[];
  counter?: ProposalCounter;
  /** Set only by a final accept. */
  commitmentId?: string;
  createdBy: string;
  idempotencyKey: string;
  /** Optimistic lock. Every write is conditional on the version it loaded. */
  version: number;
  createdAt: string;
  updatedAt: string;
  entityType: 'CapacityProposal';
}

export interface CapacityIdempotencyDdbItem {
  PK: string;
  SK: string;
  scopeHash: string;
  requestHash: string;
  operation: string;
  actorId: string;
  vendorId: string;
  proposalId: string;
  commitmentId?: string;
  createdAt: string;
  /** Epoch seconds. Only effective when TTL is enabled on the table for this attribute. */
  expiresAt: number;
  entityType: 'CapacityIdempotency';
}

/** The state a proposal must be in for each action. */
const ALLOWED_FROM: Record<ProposalAction, readonly CapacityProposalStatus[]> = {
  CREATE: [],
  SEND: ['DRAFT'],
  ACCEPT: ['SENT'],
  COUNTER: ['SENT'],
  ACCEPT_COUNTER: ['COUNTERED'],
  REVISE: ['SENT', 'COUNTERED', 'DECLINED', 'EXPIRED'],
  DECLINE: ['DRAFT', 'SENT', 'COUNTERED'],
  EXPIRE: ['SENT'],
  CANCEL: ['DRAFT', 'SENT', 'COUNTERED'],
};

export function assertCanTransition(
  proposal: Pick<CapacityProposalDdbItem, 'status' | 'proposalId'>,
  action: ProposalAction,
): void {
  if (!ALLOWED_FROM[action].includes(proposal.status)) {
    throw new ConflictError(
      `Proposal in status ${proposal.status} cannot be changed by ${action}`,
    );
  }
}

export function isDeadlinePassed(
  proposal: Pick<CapacityProposalDdbItem, 'responseDeadline'>,
  now: Date,
): boolean {
  return Date.parse(proposal.responseDeadline) <= now.getTime();
}

export function assertFutureDeadline(responseDeadline: string, now: Date): void {
  const ms = Date.parse(responseDeadline);
  if (!Number.isFinite(ms)) {
    throw new ValidationError('responseDeadline must be an ISO-8601 date-time');
  }
  if (ms <= now.getTime()) {
    throw new ValidationError('responseDeadline must be in the future');
  }
}

export function historyEntry(input: {
  at: string;
  actorId: string;
  actorRole: ProposalActorRole;
  action: ProposalAction;
  fromStatus?: CapacityProposalStatus;
  toStatus?: CapacityProposalStatus;
  note?: string;
}): CapacityProposalHistoryEntry {
  const note = input.note?.trim();
  return {
    at: input.at,
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.action,
    ...(input.fromStatus ? { fromStatus: input.fromStatus } : {}),
    ...(input.toStatus ? { toStatus: input.toStatus } : {}),
    ...(note ? { note } : {}),
  };
}

export function appendHistory(
  history: readonly CapacityProposalHistoryEntry[],
  entry: CapacityProposalHistoryEntry,
): CapacityProposalHistoryEntry[] {
  return [...history, entry].slice(-MAX_PROPOSAL_HISTORY);
}

/** Stable JSON so the same request body always hashes the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Idempotency scope: key + operation + actor + target, so a key cannot cross operations. */
export function idempotencyScopeHash(input: {
  operation: string;
  actorId: string;
  target: string;
  key: string;
}): string {
  return hashRequest(input);
}

export interface CapacityProposalDto {
  proposalId: string;
  vendorId: string;
  communityId: string;
  packageScope: PackageScope;
  serviceWindow: ServiceWindow;
  quantity: number;
  responseDeadline: string;
  proposedPayoutRate: PayoutRate;
  status: CapacityProposalStatus;
  history: CapacityProposalHistoryEntry[];
  counter?: ProposalCounter;
  commitmentId?: string;
  createdBy: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

/** Strips table keys. The creation idempotency key is only returned to admins. */
export function toProposalDto(
  item: CapacityProposalDdbItem,
  options: { includeIdempotencyKey: boolean },
): CapacityProposalDto {
  return {
    proposalId: item.proposalId,
    vendorId: item.vendorId,
    communityId: item.communityId,
    packageScope: item.packageScope,
    serviceWindow: item.serviceWindow,
    quantity: item.quantity,
    responseDeadline: item.responseDeadline,
    proposedPayoutRate: item.proposedPayoutRate,
    status: item.status,
    history: item.history,
    ...(item.counter ? { counter: item.counter } : {}),
    ...(item.commitmentId ? { commitmentId: item.commitmentId } : {}),
    createdBy: item.createdBy,
    ...(options.includeIdempotencyKey ? { idempotencyKey: item.idempotencyKey } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
