import { PackageVisitRecord } from '../types/package-visit.types';
import { applyCompletionReview } from './visit-completion';

const NOW = '2026-10-31T08:00:00.000Z';

const completed = (patch: Partial<PackageVisitRecord> = {}) => ({
  visitId: 'visit-1',
  status: 'COMPLETED',
  entitlementConsumed: true,
  validationStatus: 'PENDING_REVIEW',
  payoutEligible: false,
  version: 1,
  completionEvidence: {
    checklist: [{ itemId: 'a', label: 'Exterior wash', done: true }],
    evidenceKeys: [],
    submittedAt: '2026-10-31T07:00:00.000Z',
    submittedBy: { staffId: 'staff-1' },
  },
  ...patch,
}) as unknown as PackageVisitRecord;

describe('applyCompletionReview', () => {
  it('sets payoutEligible only when approved', () => {
    const approved = applyCompletionReview(completed(), { decision: 'APPROVED' }, 'admin-1', NOW);
    expect(approved.visit).toMatchObject({ validationStatus: 'APPROVED', payoutEligible: true, reviewedBy: 'admin-1', version: 2 });

    const rejected = applyCompletionReview(completed(), { decision: 'REJECTED', note: 'photos unclear' }, 'admin-1', NOW);
    expect(rejected.visit).toMatchObject({ validationStatus: 'REJECTED', payoutEligible: false, reviewNote: 'photos unclear' });
  });

  it('is idempotent on the same decision and refuses to flip a decided review', () => {
    const approved = completed({ validationStatus: 'APPROVED', payoutEligible: true } as Partial<PackageVisitRecord>);
    expect(applyCompletionReview(approved, { decision: 'APPROVED' }, 'admin-1', NOW).idempotent).toBe(true);
    expect(() => applyCompletionReview(approved, { decision: 'REJECTED' }, 'admin-1', NOW))
      .toThrow(expect.objectContaining({ code: 'REVIEW_ALREADY_DECIDED' }));
  });

  it('refuses visits that are not completed with evidence', () => {
    expect(() => applyCompletionReview(completed({ status: 'IN_PROGRESS' } as Partial<PackageVisitRecord>), { decision: 'APPROVED' }, 'a', NOW))
      .toThrow(expect.objectContaining({ code: 'VISIT_NOT_REVIEWABLE' }));
  });
});
