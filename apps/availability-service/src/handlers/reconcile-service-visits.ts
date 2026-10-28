import { withApiHandler } from '@api-hub/middleware';
import { ForbiddenError, LambdaRequest, ValidationError } from '@api-hub/utils';
import type { ServiceVisitSnapshot } from '@api-hub/event-platform';

import { getAuthenticatedUserId, isAdminCaller, hasVendorRole } from '../auth/access';
import { applyVisitProjection } from '../domain/visit-projection';
import { getVisitProjectionRepository } from '../repositories/visit-projections.repository';

/**
 * Rebuilds the local projection from catalog snapshots when an event was missed.
 * The caller supplies the catalog records. This does not read the catalog table.
 */
export const handleReconcileServiceVisits = withApiHandler(
  { operation: 'reconcileservicevisits' },
  async (request: LambdaRequest) => reconcileServiceVisits(request),
);

export async function reconcileServiceVisits(request: LambdaRequest): Promise<{ applied: number; ignored: number }> {
  getAuthenticatedUserId(request);
  if (!isAdminCaller(request) && !hasVendorRole(request)) {
    throw new ForbiddenError('Vendor access is required');
  }
  const body = (request.body ?? {}) as { visits?: ServiceVisitSnapshot[] };
  if (!Array.isArray(body.visits)) {
    throw new ValidationError('visits is required');
  }
  const vendorId = request.pathParameters?.vendorId ?? request.params?.vendorId;
  const repository = getVisitProjectionRepository();
  let applied = 0;
  let ignored = 0;
  for (const visit of body.visits) {
    if (!visit || visit.vendorId !== vendorId) {
      throw new ValidationError('Every snapshot must belong to this vendor');
    }
    const current = await repository.find(visit.vendorId, visit.visitId);
    const decision = applyVisitProjection(current, visit);
    if (!decision.applied) {
      ignored += 1;
      continue;
    }
    const wrote = await repository.apply(visit);
    if (wrote) {
      applied += 1;
    } else {
      ignored += 1;
    }
  }
  return { applied, ignored };
}
