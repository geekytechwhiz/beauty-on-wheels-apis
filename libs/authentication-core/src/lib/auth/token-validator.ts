import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '@api-hub/utils';

import type { CognitoConfig } from '../config/cognito.config';
import { getCognitoConfig } from '../config/cognito.config';
import { parseAccessTokenRolesClaim } from './application-roles';
import { getJwksCache, type JwksCache } from './jwks-cache';
import type { VerifiedPayload } from '../types';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function issuerMatchesPool(issuer: string, config: CognitoConfig): boolean {
  return (
    issuer === config.issuer ||
    issuer === `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`
  );
}

function audienceMatches(
  payload: jwt.JwtPayload,
  appClientId: string,
): boolean {
  const tokenUse = asString(payload.token_use);

  if (tokenUse === 'id') {
    const aud = payload.aud;
    if (typeof aud === 'string') {
      return aud === appClientId;
    }
    if (Array.isArray(aud)) {
      return aud.includes(appClientId);
    }
    return false;
  }

  const clientId = asString(payload.client_id);
  return clientId === appClientId;
}

export type ValidateAccessTokenOptions = {
  config?: CognitoConfig;
  jwksCache?: JwksCache;
  /** When set, `token_use` must match. Omit to accept both access and id tokens. */
  expectedTokenUse?: 'access' | 'id';
};

/**
 * Verifies a Cognito JWT (signature via JWKS, issuer, expiry, user pool, audience/client).
 * Access tokens (`token_use=access`) are preferred; ID tokens are accepted when `aud` matches.
 * When `roles` is present it must be an application-role list. A missing `roles`
 * claim is accepted so tokens issued before that claim still validate. `scope`
 * is not interpreted as an application role.
 */
export async function validateAccessToken(
  token: string,
  options: ValidateAccessTokenOptions = {},
): Promise<VerifiedPayload> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.split('.').length !== 3) {
    throw new UnauthorizedError('Invalid token');
  }

  const config = options.config ?? getCognitoConfig();
  const decoded = jwt.decode(trimmed, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header?.kid) {
    throw new UnauthorizedError('Invalid token');
  }

  const cache = options.jwksCache ?? getJwksCache(config.jwksUri);
  let pem: string;
  try {
    pem = await cache.getPem(decoded.header.kid);
  } catch {
    throw new UnauthorizedError('Invalid token');
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(trimmed, pem, {
      algorithms: ['RS256'],
      issuer: config.issuer,
      clockTolerance: 5,
    }) as jwt.JwtPayload;
  } catch {
    throw new UnauthorizedError('Invalid token');
  }

  const issuer = asString(payload.iss);
  if (!issuer || !issuerMatchesPool(issuer, config)) {
    throw new UnauthorizedError('Invalid token');
  }

  if (!audienceMatches(payload, config.appClientId)) {
    throw new UnauthorizedError('Invalid token');
  }

  const sub = asString(payload.sub);
  if (!sub) {
    throw new UnauthorizedError('Invalid token');
  }

  const parsedRoles = parseAccessTokenRolesClaim(payload.roles);
  if (!parsedRoles.ok) {
    throw new UnauthorizedError('Invalid token');
  }
  if (parsedRoles.roles) {
    payload.roles = parsedRoles.roles;
  }

  const tokenUse = asString(payload.token_use);
  if (options.expectedTokenUse) {
    if (tokenUse !== options.expectedTokenUse) {
      throw new UnauthorizedError('Invalid token');
    }
  } else if (tokenUse && tokenUse !== 'access' && tokenUse !== 'id') {
    throw new UnauthorizedError('Invalid token');
  }

  return payload as VerifiedPayload;
}

export function readBearerToken(authorizationHeader?: string): string {
  if (!authorizationHeader || !authorizationHeader.trim()) {
    throw new UnauthorizedError('Missing Authorization header');
  }

  const trimmed = authorizationHeader.trim();
  const bearer = trimmed.match(/^Bearer\s+(\S+)\s*$/i);
  if (bearer?.[1]) {
    return bearer[1];
  }

  // TOKEN authorizers sometimes receive the raw JWT without a Bearer scheme.
  if (trimmed.split('.').length === 3 && !/\s/.test(trimmed)) {
    return trimmed;
  }

  throw new UnauthorizedError('Invalid Authorization format');
}
