import { BookingError } from '../errors';
import {
  PACKAGE_VISIT_STATUS,
  PackageVisitRecord,
  VISIT_VALIDATION_STATUS,
  VisitCompletionEvidence,
} from '../types/package-visit.types';

export interface CompletionSubmission {
  checklist: Array<{ itemId: string; label: string; done: true }>;
  evidenceObjectKeys?: string[];
}

export interface CompletionActor {
  staffId: string;
  userId?: string;
}

/** Object-key prefix a visit's evidence must live under. Prevents citing another visit's files. */
export function evidencePrefix(vendorId: string, visitId: string): string {
  return `visit-evidence/${vendorId}/${visitId}/`;
}

export function assertEvidenceKeysBelongToVisit(
  keys: readonly string[],
  vendorId: string,
  visitId: string,
): void {
  const prefix = evidencePrefix(vendorId, visitId);
  for (const key of keys) {
    const name = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new BookingError(
        'INVALID_EVIDENCE_KEY',
        'evidenceObjectKeys must be keys issued by the evidence upload-url route for this visit',
        400,
        'evidenceObjectKeys',
        false,
      );
    }
  }
  if (new Set(keys).size !== keys.length) {
    throw new BookingError('INVALID_EVIDENCE_KEY', 'evidenceObjectKeys must be unique', 400, 'evidenceObjectKeys', false);
  }
}

export function buildCompletionEvidence(
  input: CompletionSubmission,
  actor: CompletionActor,
  nowIso: string,
): VisitCompletionEvidence {
  return {
    checklist: input.checklist.map((item) => ({ itemId: item.itemId, label: item.label, done: true as const })),
    evidenceKeys: [...(input.evidenceObjectKeys ?? [])],
    submittedAt: nowIso,
    submittedBy: { staffId: actor.staffId, ...(actor.userId ? { userId: actor.userId } : {}) },
  };
}

/** True when a replayed complete carries exactly the evidence already stored. */
export function sameSubmission(
  stored: VisitCompletionEvidence | undefined,
  input: CompletionSubmission,
): boolean {
  if (!stored) return false;
  const sortedItems = (items: Array<{ itemId: string; label: string }>) => JSON.stringify(
    [...items].map((item) => [item.itemId, item.label]).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const keys = [...(input.evidenceObjectKeys ?? [])].sort();
  const storedKeys = [...stored.evidenceKeys].sort();
  return sortedItems(stored.checklist) === sortedItems(input.checklist)
    && JSON.stringify(keys) === JSON.stringify(storedKeys);
}

/**
 * Replay of a completed visit. Identical evidence is an idempotent success.
 * Different evidence is refused so a vendor cannot rewrite what an admin may be
 * reviewing (or has approved).
 */
export function assertReplayMatches(visit: PackageVisitRecord, input: CompletionSubmission): void {
  // Visits completed before evidence was required keep their old idempotent replay.
  if (!visit.completionEvidence) return;
  if (sameSubmission(visit.completionEvidence, input)) return;
  if (visit.validationStatus === VISIT_VALIDATION_STATUS.APPROVED) {
    throw new BookingError(
      'EVIDENCE_LOCKED',
      'Completion evidence cannot be changed after the visit was approved',
      409,
      'evidenceObjectKeys',
      false,
    );
  }
  throw new BookingError(
    'VISIT_ALREADY_COMPLETED',
    'Visit is already completed; evidence cannot be resubmitted',
    409,
    'visitId',
    false,
  );
}

export function assertEvidenceMutable(visit: PackageVisitRecord): void {
  if (visit.validationStatus === VISIT_VALIDATION_STATUS.APPROVED) {
    throw new BookingError(
      'EVIDENCE_LOCKED',
      'Completion evidence cannot be changed after the visit was approved',
      409,
      'visitId',
      false,
    );
  }
}

export function applyCompletionReview(
  visit: PackageVisitRecord,
  review: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  reviewerId: string,
  nowIso: string,
): { visit: PackageVisitRecord; idempotent: boolean } {
  if (visit.status !== PACKAGE_VISIT_STATUS.COMPLETED || !visit.completionEvidence) {
    throw new BookingError(
      'VISIT_NOT_REVIEWABLE',
      'Only completed visits with submitted evidence can be reviewed',
      409,
      'visitId',
      false,
    );
  }
  if (visit.validationStatus === review.decision) return { visit, idempotent: true };
  if (visit.validationStatus !== VISIT_VALIDATION_STATUS.PENDING_REVIEW) {
    throw new BookingError(
      'REVIEW_ALREADY_DECIDED',
      `Completion review is already ${visit.validationStatus ?? 'decided'}`,
      409,
      'decision',
      false,
    );
  }
  const approved = review.decision === VISIT_VALIDATION_STATUS.APPROVED;
  return {
    idempotent: false,
    visit: {
      ...visit,
      validationStatus: review.decision,
      payoutEligible: approved,
      reviewedAt: nowIso,
      reviewedBy: reviewerId,
      ...(review.note ? { reviewNote: review.note } : {}),
      updatedAt: nowIso,
      version: visit.version + 1,
    },
  };
}
