import {
  BaseError,
  LambdaRequest,
  UnauthorizedError,
  type UserContext,
} from '@api-hub/utils';

import type { AuthContext, AuthenticateOptions } from './auth-context';
import {
  effectiveAccessTokenRoles,
  parseAccessTokenRolesClaim,
} from './application-roles';
import { readAuthorizerContextFromEvent } from './authorizer-context';
import { readBearerToken, validateAccessToken } from './token-validator';
import { USER_STATUS } from '../constants/identity.constants';

function isActiveStatus(status?: string): boolean {
  if (!status) {
    return true;
  }
  const normalized = status.trim().toLowerCase();
  return normalized === USER_STATUS.ACTIVE;
}

function claimsFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      continue;
    }
    claims[key] = value;
  }
  return claims;
}

function attachAuthContext(request: LambdaRequest, ctx: AuthContext): void {
  request.context.authContext = ctx;

  const userContext: UserContext = {
    ...(request.context.userContext ?? {}),
    userId: ctx.userId,
    identityId: ctx.identityId,
    roles: ctx.roles,
    permissions: ctx.permissions,
  };
  request.context.userContext = userContext;
}

async function resolveApplicationUser(
  ctx: AuthContext,
  options: AuthenticateOptions,
): Promise<AuthContext> {
  const directory = options.userDirectory;
  const requireApplicationUser =
    options.requireApplicationUser ?? Boolean(directory);

  if (!directory) {
    return ctx;
  }

  const user = await directory.findUserByIdentityId(ctx.identityId);
  if (!user) {
    if (requireApplicationUser) {
      throw new BaseError(
        'Application user mapping not found',
        403,
        'APPLICATION_USER_NOT_FOUND',
        undefined,
        {
          metadata: {
            identityId: ctx.identityId,
            tokenUse:
              typeof ctx.claims.token_use === 'string'
                ? ctx.claims.token_use
                : undefined,
          },
        },
      );
    }
    return ctx;
  }

  if (!isActiveStatus(user.status)) {
    throw new UnauthorizedError('Account is not active');
  }

  ctx.userId = user.userId;
  const tokenRoles = parseAccessTokenRolesClaim(ctx.claims.roles);
  if (!tokenRoles.ok) {
    throw new UnauthorizedError('Invalid roles claim');
  }
  // Always re-read Identity. A still-valid access token must not keep a role
  // that has been revoked. Directory failures propagate and deny the request.
  const directoryRoleIds = await directory.getUserRoles(user.userId);
  ctx.roles = effectiveAccessTokenRoles({
    tokenRoles: tokenRoles.roles,
    directoryRoleIds,
    profileRoleId: user.roleId,
  });
  ctx.permissions = await directory.getPermissionsForRoles(ctx.roles);
  return ctx;
}

/**
 * Validates the Bearer token on the request and builds {@link AuthContext}.
 * Identity is taken only from a verified JWT `sub` or API Gateway authorizer
 * context — never from body, query, or arbitrary headers.
 */
export async function authenticate(
  request: LambdaRequest,
  options: AuthenticateOptions = {},
): Promise<AuthContext> {
  const fromGateway = readAuthorizerContextFromEvent(
    request.event as {
      requestContext?: { authorizer?: Record<string, unknown> | null };
    },
  );
  if (fromGateway?.identityId) {
    const ctx = fromGateway.userId
      ? fromGateway
      : await resolveApplicationUser(fromGateway, options);
    attachAuthContext(request, ctx);
    return ctx;
  }

  const existing = request.context.authContext;
  if (existing?.identityId) {
    attachAuthContext(request, existing);
    return existing;
  }

  const header = request.context.authHeader;
  const token = readBearerToken(header);
  const payload = await validateAccessToken(token, {
    expectedTokenUse: options.expectedTokenUse,
  });

  const identityId = payload.sub;
  const claims = claimsFromPayload(payload as unknown as Record<string, unknown>);

  const ctx: AuthContext = {
    identityId,
    roles: [],
    permissions: [],
    claims,
  };

  await resolveApplicationUser(ctx, options);
  attachAuthContext(request, ctx);
  return ctx;
}

export function getAuthContext(request: LambdaRequest): AuthContext | undefined {
  return request.context.authContext;
}

export function requireAuthContext(request: LambdaRequest): AuthContext {
  const ctx = getAuthContext(request);
  if (!ctx?.identityId) {
    throw new UnauthorizedError('Unauthorized');
  }
  return ctx;
}
