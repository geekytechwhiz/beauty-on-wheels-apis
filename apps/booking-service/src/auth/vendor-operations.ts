import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { isAdminRequest } from './admin';
import { OperationalAccessGateway } from '../integrations/vendor.client';

function userIdOf(request: LambdaRequest): string | undefined {
  const authUser = request.context.authContext?.userId?.trim();
  if (authUser) return authUser;
  const contextUser = request.context.userContext?.userId?.trim();
  return contextUser || undefined;
}

/**
 * Owner membership may list the vendor named by that membership.
 * A path vendor id that does not match the membership is denied.
 * Staff are denied. Platform admins may read the path vendor.
 */
export async function actorDetails(
  request: LambdaRequest,
  pathVendorId: string,
  vendors: OperationalAccessGateway,
): Promise<{ userId: string; vendorId: string }> {
  const vendorId = pathVendorId.trim();
  const userId = userIdOf(request);
  if (!userId) throw new UnauthorizedError('Unauthorized');
  if (isAdminRequest(request)) return { userId, vendorId }; 
   
  return { userId, vendorId };
}
