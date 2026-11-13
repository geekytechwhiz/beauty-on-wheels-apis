import { createHash } from 'crypto';
import { EntityIdGenerator } from '@api-hub/utils';

import { BookingError } from '../errors';
import {
  IssueActor,
  IssueHistoryAction,
  IssueHistoryEntry,
  OpsIssueResponse,
  VENDOR_ISSUE_STATUS,
  VendorIssueRecord,
  VendorIssueResponse,
  VendorIssueStatus,
  VendorIssueType,
} from '../types/vendor-issue.types';
export const MAX_ISSUE_ATTACHMENTS = 10;

export function issueObjectPrefix(vendorId: string, issueId: string): string {
  return `issues/${vendorId}/${issueId}/`;
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function newIssueId(): string {
  return EntityIdGenerator.IssueId();
}

/** Only an explicit, unresolved block stops a visit. Legacy rows without `blocksVisit` never block. */
export function isActiveVisitBlocker(issue: { blocksVisit?: boolean; status: VendorIssueStatus }): boolean {
  return issue.blocksVisit === true && issue.status !== VENDOR_ISSUE_STATUS.RESOLVED;
}

export function createIssueRecord(input: {
  issueId?: string;
  vendorId: string;
  visitId?: string;
  communityId?: string;
  commitmentId?: string;
  type: VendorIssueType;
  description: string;
  requestedHelp?: string;
  blocksVisit?: boolean;
  actor: IssueActor;
  nowIso: string;
}): VendorIssueRecord {
  return {
    issueId: input.issueId ?? newIssueId(),
    vendorId: input.vendorId,
    ...(input.visitId ? { visitId: input.visitId } : {}),
    ...(input.communityId ? { communityId: input.communityId } : {}),
    ...(input.commitmentId ? { commitmentId: input.commitmentId } : {}),
    type: input.type,
    description: input.description,
    ...(input.requestedHelp ? { requestedHelp: input.requestedHelp } : {}),
    ...(input.blocksVisit === true ? { blocksVisit: true } : {}),
    ...(input.blocksVisit === true ? { blockingStartedAt: input.nowIso } : {}),
    status: VENDOR_ISSUE_STATUS.OPEN,
    attachments: [],
    createdBy: input.actor,
    internalNotes: [],
    history: [{
      at: input.nowIso,
      by: input.actor,
      action: 'CREATED',
      toStatus: VENDOR_ISSUE_STATUS.OPEN,
    }],
    version: 1,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}

function entry(
  issue: VendorIssueRecord,
  action: IssueHistoryAction,
  actor: IssueActor,
  nowIso: string,
  toStatus: VendorIssueStatus,
  note?: string,
): IssueHistoryEntry {
  return {
    at: nowIso,
    by: actor,
    action,
    fromStatus: issue.status,
    toStatus,
    ...(note ? { note } : {}),
  };
}

function conflict(code: string, message: string): BookingError {
  return new BookingError(code, message, 409, 'status', false);
}

export type OpsIssueAction = 'triage' | 'assign' | 'resolve' | 'request-action';

export interface OpsIssueInput {
  /** triage/assign: internal note. request-action: vendor-visible instruction. */
  note?: string;
  assigneeUserId?: string;
  outcome?: string;
}

/**
 * Admin transitions. Every one appends a history entry. A repeat of the action
 * that already produced the current state returns the stored issue unchanged.
 *
 * - triage:         OPEN -> TRIAGED
 * - assign:         OPEN|TRIAGED|ACTION_REQUIRED, sets assignedTo; OPEN becomes TRIAGED
 *                   because an assigned issue has been picked up.
 * - request-action: OPEN|TRIAGED -> ACTION_REQUIRED (the note tells the vendor what to do)
 * - resolve:        any non-RESOLVED -> RESOLVED, outcome required
 */
export function applyOpsAction(
  issue: VendorIssueRecord,
  action: OpsIssueAction,
  input: OpsIssueInput,
  actor: IssueActor,
  nowIso: string,
): { issue: VendorIssueRecord; idempotent: boolean } {
  const { status } = issue;
  const bump = { updatedAt: nowIso, version: issue.version + 1 };
  const internal = (note?: string) => (
    note ? [...issue.internalNotes, { at: nowIso, by: actor.userId, note }] : issue.internalNotes
  );

  if (action === 'triage') {
    if (status === VENDOR_ISSUE_STATUS.TRIAGED) return { issue, idempotent: true };
    if (status !== VENDOR_ISSUE_STATUS.OPEN) {
      throw conflict('ISSUE_INVALID_TRANSITION', `Cannot triage an issue that is ${status}`);
    }
    return {
      idempotent: false,
      issue: {
        ...issue,
        status: VENDOR_ISSUE_STATUS.TRIAGED,
        internalNotes: internal(input.note),
        history: [...issue.history, entry(issue, 'TRIAGED', actor, nowIso, VENDOR_ISSUE_STATUS.TRIAGED)],
        ...bump,
      },
    };
  }

  if (action === 'assign') {
    const assignee = input.assigneeUserId?.trim();
    if (!assignee) {
      throw new BookingError('VALIDATION_ERROR', 'assigneeUserId is required', 400, 'assigneeUserId', false);
    }
    if (status === VENDOR_ISSUE_STATUS.RESOLVED) {
      throw conflict('ISSUE_INVALID_TRANSITION', 'Cannot assign a resolved issue');
    }
    if (issue.assignedTo === assignee) return { issue, idempotent: true };
    const next: VendorIssueStatus = status === VENDOR_ISSUE_STATUS.OPEN ? VENDOR_ISSUE_STATUS.TRIAGED : status;
    return {
      idempotent: false,
      issue: {
        ...issue,
        status: next,
        assignedTo: assignee,
        internalNotes: internal(input.note),
        history: [...issue.history, entry(issue, 'ASSIGNED', actor, nowIso, next)],
        ...bump,
      },
    };
  }

  if (action === 'request-action') {
    const note = input.note?.trim();
    if (!note) {
      throw new BookingError('VALIDATION_ERROR', 'note is required: tell the vendor what action is needed', 400, 'note', false);
    }
    if (status === VENDOR_ISSUE_STATUS.ACTION_REQUIRED) return { issue, idempotent: true };
    if (status === VENDOR_ISSUE_STATUS.RESOLVED) {
      throw conflict('ISSUE_INVALID_TRANSITION', 'Cannot request action on a resolved issue');
    }
    return {
      idempotent: false,
      issue: {
        ...issue,
        status: VENDOR_ISSUE_STATUS.ACTION_REQUIRED,
        history: [...issue.history, entry(issue, 'ACTION_REQUESTED', actor, nowIso, VENDOR_ISSUE_STATUS.ACTION_REQUIRED, note)],
        ...bump,
      },
    };
  }

  const outcome = input.outcome?.trim();
  if (!outcome) {
    throw new BookingError('VALIDATION_ERROR', 'outcome is required to resolve an issue', 400, 'outcome', false);
  }
  if (status === VENDOR_ISSUE_STATUS.RESOLVED) {
    if (issue.resolutionOutcome === outcome) return { issue, idempotent: true };
    throw conflict('ISSUE_ALREADY_RESOLVED', 'Issue is already resolved with a different outcome');
  }
  return {
    idempotent: false,
    issue: {
      ...issue,
      status: VENDOR_ISSUE_STATUS.RESOLVED,
      resolutionOutcome: outcome,
      resolvedAt: nowIso,
      internalNotes: internal(input.note),
      history: [...issue.history, entry(issue, 'RESOLVED', actor, nowIso, VENDOR_ISSUE_STATUS.RESOLVED, outcome)],
      ...bump,
    },
  };
}

export function toVendorIssueResponse(issue: VendorIssueRecord): VendorIssueResponse {
  const { internalNotes: _internal, assignedTo: _assignedTo, version: _version, ...rest } = issue;
  return {
    ...rest,
    // Vendors see that platform ops acted, not which admin did.
    history: issue.history.map((item) => (
      item.by.role === 'ADMIN' ? { ...item, by: { userId: 'platform-ops', role: 'ADMIN' as const } } : item
    )),
  };
}

export function toOpsIssueResponse(issue: VendorIssueRecord): OpsIssueResponse {
  const { version: _version, ...rest } = issue;
  return rest;
}
