import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { OperationalAccessGateway } from '../integrations/vendor.client';
import { SchedulingCrewGateway } from '../integrations/scheduling-crews.client';
import { PackageVisitRecord } from '../types/package-visit.types';
import { IssueActor } from '../types/vendor-issue.types';
import { callerUserId, isAdminRequest } from './admin';

/**
 * Principal for vendor-scoped issue and evidence routes. The vendor comes from
 * the caller's membership, never from the body. The path vendor must match it.
 */
export type VendorScopedActor =
  | { kind: 'owner'; userId: string; vendorId: string }
  | { kind: 'crew'; userId: string; vendorId: string; staffId: string; crewIds: ReadonlySet<string> }
  | { kind: 'admin'; userId: string; vendorId: string };

export async function resolveVendorScopedActor(
  request: LambdaRequest,
  pathVendorId: string,
  vendors: OperationalAccessGateway,
  crews: SchedulingCrewGateway,
): Promise<VendorScopedActor> {
  const vendorId = pathVendorId.trim();
  const userId = callerUserId(request);
  if (!userId) throw new UnauthorizedError('Unauthorized');
  if (isAdminRequest(request)) return { kind: 'admin', userId, vendorId };
  const membership = await vendors.getOperationalAccess(userId);
  if (!membership.active || membership.vendorId !== vendorId) {
    throw new ForbiddenError('Not authorized for this vendor');
  }
  if (membership.role === 'owner') return { kind: 'owner', userId, vendorId };
  if (membership.role !== 'staff' || !membership.staffId) {
    throw new ForbiddenError('Not authorized for this vendor');
  }
  const activeCrewIds = new Set((await crews.listCrews(vendorId))
    .filter((crew) => crew.status === 'ACTIVE' && crew.staff.some((member) => member.staffId === membership.staffId && member.status === 'ACTIVE'))
    .map((crew) => crew.crewId));
  if (!activeCrewIds.size) throw new ForbiddenError('Active crew membership is required');
  return { kind: 'crew', userId, vendorId, staffId: membership.staffId, crewIds: activeCrewIds };
}

/** Owners act on any visit of their vendor. Crew act only on visits assigned to their active crew. */
export function assertVisitScope(actor: VendorScopedActor, visit: PackageVisitRecord): void {
  if (visit.vendorId !== actor.vendorId) throw new ForbiddenError('Visit does not belong to this vendor');
  if (actor.kind === 'crew' && (!visit.crewAssignment?.crewId || !actor.crewIds.has(visit.crewAssignment.crewId))) {
    throw new ForbiddenError('Crew is not assigned to this visit');
  }
}

export function toIssueActor(actor: VendorScopedActor): IssueActor {
  const role = actor.kind === 'owner' ? 'VENDOR_OWNER' : actor.kind === 'crew' ? 'CREW' : 'ADMIN';
  return { userId: actor.userId, role };
}
