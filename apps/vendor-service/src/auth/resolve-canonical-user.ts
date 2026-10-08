import {
  BaseError,
  LambdaRequest,
  UnauthorizedError,
} from '@api-hub/utils';
import {
  DynamoDbAuthUserDirectory,
  USER_STATUS,
  type AuthUserDirectory,
} from '@api-hub/authentication-core';

import { env } from '../configs/env.config';
import {
  assignCanonicalUserId,
  getOptionalAuthenticatedUserId,
  getRequestIdentityId,
} from '../utils/helpers/vendor-request';

function isActiveStatus(status?: string): boolean {
  if (!status) {
    return true;
  }
  return status.trim().toLowerCase() === USER_STATUS.ACTIVE;
}

/**
 * Resolves the Identity Service application user id.
 * Uses the authorizer userId when present. When the authorizer only supplied
 * Cognito identityId, looks up the existing identity → user mapping.
 */
export async function ensureCanonicalUserId(
  request: LambdaRequest,
  directory?: AuthUserDirectory,
): Promise<string> {
  const presented = getOptionalAuthenticatedUserId(request);
  if (presented) {
    assignCanonicalUserId(request, presented);
    return presented;
  }

  const identityId = getRequestIdentityId(request);
  if (!identityId) {
    throw new UnauthorizedError('Unauthorized');
  }

  const table = env.IDENTITY_TABLE;
  if (!directory && !table) {
    throw new UnauthorizedError('Authenticated user id is required');
  }

  const resolved = await (
    directory ?? new DynamoDbAuthUserDirectory(table)
  ).findUserByIdentityId(identityId);

  if (!resolved?.userId?.trim()) {
    throw new BaseError(
      'Application user mapping not found',
      403,
      'APPLICATION_USER_NOT_FOUND',
      undefined,
      { metadata: { identityId } },
    );
  }

  if (!isActiveStatus(resolved.status)) {
    throw new UnauthorizedError('Account is not active');
  }

  const userId = resolved.userId.trim();
  assignCanonicalUserId(request, userId);
  return userId;
}
