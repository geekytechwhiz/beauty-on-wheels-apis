import {
  authenticate,
  authorize,
  type AuthContext,
  type AuthorizeOptions,
} from '@api-hub/authentication-core';
import type { LambdaRequest } from '@api-hub/utils';

import { getIdentityAuthUserDirectory } from './identity-user-directory';

export async function requireAuth(request: LambdaRequest): Promise<AuthContext> {
  // Prefers API Gateway authorizer context; JWT/JWKS runs only when that context is absent.
  return authenticate(request, {
    userDirectory: getIdentityAuthUserDirectory(),
    requireApplicationUser: true,
  });
}

export function requirePermission(permissions: string[] | AuthorizeOptions) {
  const options: AuthorizeOptions = Array.isArray(permissions)
    ? { permissions }
    : permissions;

  return async (request: LambdaRequest): Promise<AuthContext> => {
    await requireAuth(request);
    return authorize(request, options, {
      userDirectory: getIdentityAuthUserDirectory(),
      requireApplicationUser: true,
    });
  };
}
