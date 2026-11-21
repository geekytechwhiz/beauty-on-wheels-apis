import { isInternalServiceAuth } from '@api-hub/authentication-core';
import { withApiHandler } from '@api-hub/middleware';
import { BaseError, ForbiddenError, LambdaRequest } from '@api-hub/utils';

import {
  getOperationalAccess,
  partnerManagerRead,
} from './internal';

function assertInternalService(request: LambdaRequest): void {
  if (!isInternalServiceAuth(request.context.authContext)) {
    throw new ForbiddenError('Internal service authentication is required');
  }
}

/**
 * HTTP adapter for Partner BFF / Booking membership resolution.
 * Body: `{ userId }`. Auth is the platform internal bearer only.
 */
export const handleGetOperationalAccess = withApiHandler(
  { operation: 'internalGetOperationalAccess' },
  async (request: LambdaRequest) => {
    assertInternalService(request);
    const result = await getOperationalAccess(
      request.body as { userId?: unknown },
    );
    return unwrapInternal(result);
  },
);

/**
 * HTTP adapter for Partner BFF vendor manager reads (crews, commitments, labels).
 * Body matches the direct-Lambda partnerManagerRead payload.
 */
export const handlePartnerManagerRead = withApiHandler(
  { operation: 'internalPartnerManagerRead' },
  async (request: LambdaRequest) => {
    assertInternalService(request);
    const result = await partnerManagerRead(
      request.body as Parameters<typeof partnerManagerRead>[0],
    );
    return unwrapInternal(result);
  },
);

function unwrapInternal(result: unknown): unknown {
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as {
      error: { code?: string; message?: string; statusCode?: number };
    }).error;
    throw new BaseError(
      error?.message ?? 'Internal dependency rejected the request',
      typeof error?.statusCode === 'number' ? error.statusCode : 502,
      error?.code ?? 'DEPENDENCY_ERROR',
    );
  }
  if (result && typeof result === 'object' && 'data' in result) {
    return (result as { data: unknown }).data;
  }
  return result;
}
