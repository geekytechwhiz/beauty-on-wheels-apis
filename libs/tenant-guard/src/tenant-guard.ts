/**
 * Tenant Isolation Guard — enforces org/client isolation.
 * Callers must resolve the resource's tenant (e.g. from canonical.organizationId) and compare to request tenant.
 */

export class TenantAccessDeniedError extends Error {
  constructor(
    message: string,
    public readonly requestTenantId: string,
    public readonly resourceTenantId: string
  ) {
    super(message);
    this.name = 'TenantAccessDeniedError';
  }
}

/**
 * Returns true if the request tenant is allowed to access the resource.
 * Same-tenant only: requestTenantId must equal resourceTenantId.
 */
export function isTenantAllowed(
  requestTenantId: string,
  resourceTenantId: string
): boolean {
  if (!requestTenantId?.trim() || !resourceTenantId?.trim()) {
    return false;
  }
  return requestTenantId.trim() === resourceTenantId.trim();
}

/**
 * Asserts the resource belongs to the request tenant. Throws TenantAccessDeniedError if not.
 * Use after resolving resource's tenant (e.g. from canonical Patient.organizationId or org lookup).
 */
export function assertResourceInTenant(
  requestTenantId: string,
  resourceTenantId: string,
  resourceType?: string,
  resourceId?: string
): void {
  if (isTenantAllowed(requestTenantId, resourceTenantId)) {
    return;
  }
  const detail = [resourceType, resourceId].filter(Boolean).join(' ') || 'resource';
  throw new TenantAccessDeniedError(
    `Tenant isolation: access denied to ${detail}`,
    requestTenantId,
    resourceTenantId
  );
}
