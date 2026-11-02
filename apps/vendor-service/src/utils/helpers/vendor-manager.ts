import { LambdaRequest } from '@api-hub/utils';

import { VendorDdbItem } from '../../types/repository.types';
import { assertVendorAccess, isAdminCaller } from './authorization';

/**
 * Manager = the vendor owner (or a platform admin). Unlike assertVendorAccess,
 * this does not fall through: financial and capacity routes must never be open to
 * any authenticated caller or to vendor staff.
 */
export function assertVendorManager(
  request: LambdaRequest,
  vendor: Pick<VendorDdbItem, 'ownerUserId' | 'vendorId'>,
): { userId: string; isAdmin: boolean } {
  // Financial and capacity resources are deliberately narrower than ordinary
  // vendor resources: only the vendor owner or a platform administrator may
  // access them.  Do not use a role name supplied by the client as proof of
  // ownership; assertVendorAccess reads the verified authorizer context.
  const userId = assertVendorAccess(request, vendor);
  return { userId, isAdmin: isAdminCaller(request) };
}
