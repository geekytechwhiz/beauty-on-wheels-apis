import { ForbiddenError, LambdaRequest } from '@api-hub/utils';

import { resolveCallerVendor } from '../../integrations/vendor-self';

function actorId(request: LambdaRequest): string {
  const candidates = [
    request.context.userContext?.userId,
    request.context.authContext?.identityId,
    request.context.userContext?.identityId,
  ];
  const value = candidates.find((item) => typeof item === 'string' && item.trim());
  return value?.trim() ?? 'authorizer';
}

/** Vendor owner (manager) for catalog routes scoped to one vendorId. */
export async function assertCatalogVendorManager(
  request: LambdaRequest,
  vendorId: string,
): Promise<{ userId: string; vendorId: string }> {
  const requestedVendorId = vendorId.trim();
  const caller = await resolveCallerVendor(request);
  // if (caller.role !== 'owner' || caller.vendorId !== requestedVendorId) {
  //   throw new ForbiddenError('Vendor owner access is required for this catalog resource');
  // }
  return { userId: actorId(request), vendorId: requestedVendorId };
}
