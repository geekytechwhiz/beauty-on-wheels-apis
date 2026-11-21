import { isInternalServiceAuth } from '@api-hub/authentication-core';
import { withApiHandler } from '@api-hub/middleware';
import { ForbiddenError, LambdaRequest } from '@api-hub/utils';

import { getPartnerManagerReadService } from '../services/partner-manager-read.service';

function assertInternalService(request: LambdaRequest): void {
  if (!isInternalServiceAuth(request.context.authContext)) {
    throw new ForbiddenError('Internal service authentication is required');
  }
}

/**
 * HTTP adapter for Partner BFF manager reads (home / work / planning).
 * Authenticated only by the platform internal bearer via the shared authorizer.
 * Delegated actor membership is revalidated inside PartnerManagerReadService.
 */
export const handlePartnerManagerRead = withApiHandler(
  { operation: 'internalPartnerManagerRead' },
  async (request: LambdaRequest) => {
    assertInternalService(request);
    return getPartnerManagerReadService().read(
      request.body as Parameters<ReturnType<typeof getPartnerManagerReadService>['read']>[0],
    );
  },
);
