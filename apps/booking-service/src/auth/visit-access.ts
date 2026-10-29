import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { requireCustomerId } from './access';

/**
 * Actor resolved from verified authorizer claims.
 * Customers may view and request cancel/reschedule; only vendor staff/managers
 * may start or complete visits.
 */
export type VisitActor =
  | { kind: 'customer'; customerId: string }
  | { kind: 'vendor'; vendorId: string; staffId: string; isManager: boolean };

export function resolveVisitActor(request: LambdaRequest): VisitActor {
  const auth = request.context.authContext;
  const claims = (auth?.claims ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(auth?.roles)
    ? auth!.roles.map((role) => String(role).toLowerCase())
    : [];

  const claimVendorId = stringClaim(claims, 'vendorId', 'custom:vendorId', 'vendor_id');
  const staffId = stringClaim(claims, 'staffId', 'custom:staffId', 'sub')
    ?? auth?.userId
    ?? undefined;
  const isManager = roles.some((role) =>
    role.includes('vendor_manager')
    || role.includes('vendor-manager')
    || role.includes('vendor_owner')
    || role.includes('vendor-owner')
    || role === 'manager'
    || role === 'owner');
  const isStaff = isManager || roles.some((role) =>
    role.includes('vendor_staff')
    || role.includes('vendor-staff')
    || role.includes('vendor')
    || role === 'staff');

  if (claimVendorId && staffId && isStaff) {
    return { kind: 'vendor', vendorId: claimVendorId, staffId, isManager };
  }

  try {
    const customerId = requireCustomerId(request);
    return { kind: 'customer', customerId };
  } catch {
    throw new UnauthorizedError('Authenticated customer or vendor staff is required');
  }
}

export function assertCustomerOrVendorForPlan(
  actor: VisitActor,
  plan: { customerId: string; vendorId: string },
): void {
  if (actor.kind === 'customer' && actor.customerId === plan.customerId) return;
  if (actor.kind === 'vendor' && actor.vendorId === plan.vendorId) return;
  throw new ForbiddenError('Not authorized to access this package plan');
}

export function assertVendorStaffForPlan(
  actor: VisitActor,
  plan: { vendorId: string },
): asserts actor is Extract<VisitActor, { kind: 'vendor' }> {
  if (actor.kind !== 'vendor' || actor.vendorId !== plan.vendorId) {
    throw new ForbiddenError('Only assigned vendor staff may perform this action');
  }
}

function stringClaim(claims: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
