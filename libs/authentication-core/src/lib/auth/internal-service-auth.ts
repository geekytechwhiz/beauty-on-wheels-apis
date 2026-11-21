import { timingSafeEqual } from 'crypto';

import type { AuthContext } from './auth-context';

/** Stable principal for service-to-service calls authenticated by the platform internal token. */
export const INTERNAL_SERVICE_PRINCIPAL = 'internal-service';

/** Role placed on authorizer context for internal callers. Not a Cognito/user role. */
export const INTERNAL_SERVICE_ROLE = 'INTERNAL';

export const AUTH_KIND = {
  USER: 'user',
  INTERNAL: 'internal',
} as const;

export type AuthKind = (typeof AUTH_KIND)[keyof typeof AUTH_KIND];

/**
 * Reads the shared internal bearer token from the Lambda environment.
 * Deployments inject the value from SSM (`/{stage}/platform/internal-service-token`).
 */
export function readConfiguredInternalServiceToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env.INTERNAL_SERVICE_TOKEN?.trim();
  return value || undefined;
}

/**
 * Constant-time compare of the Authorization bearer (or raw TOKEN authorizer
 * value) against the configured internal service token.
 */
export function matchesInternalServiceToken(
  authorizationToken: string | undefined,
  configuredToken: string | undefined,
): boolean {
  if (!authorizationToken?.trim() || !configuredToken) {
    return false;
  }
  const presented = stripBearer(authorizationToken.trim());
  if (!presented || presented.length !== configuredToken.length) {
    return false;
  }
  try {
    return timingSafeEqual(
      Buffer.from(presented, 'utf8'),
      Buffer.from(configuredToken, 'utf8'),
    );
  } catch {
    return false;
  }
}

export function buildInternalServiceAuthContext(): AuthContext {
  return {
    identityId: INTERNAL_SERVICE_PRINCIPAL,
    roles: [INTERNAL_SERVICE_ROLE],
    permissions: [],
    claims: { authKind: AUTH_KIND.INTERNAL },
  };
}

export function toInternalServiceAuthorizerContext(): Record<string, string> {
  return {
    identityId: INTERNAL_SERVICE_PRINCIPAL,
    roles: JSON.stringify([INTERNAL_SERVICE_ROLE]),
    permissions: '[]',
    authKind: AUTH_KIND.INTERNAL,
  };
}

export function isInternalServiceAuth(
  auth: Pick<AuthContext, 'identityId' | 'roles'> | undefined | null,
): boolean {
  if (!auth) {
    return false;
  }
  if (auth.identityId === INTERNAL_SERVICE_PRINCIPAL) {
    return true;
  }
  return auth.roles.some(
    (role) => role.trim().toUpperCase() === INTERNAL_SERVICE_ROLE,
  );
}

function stripBearer(value: string): string {
  const match = value.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] ?? value;
}
