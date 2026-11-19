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
function unauthorizedToken(
  reason: string,
  metadata: Record<string, unknown> = {},
): never {
  throw new UnauthorizedError('Invalid token', undefined, {
    metadata: { reason, ...metadata },
  });
}

export async function validateAccessToken(
  token: string,
  options: ValidateAccessTokenOptions = {},
): Promise<VerifiedPayload> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.split('.').length !== 3) {
    unauthorizedToken('malformed_jwt');
  }

  const config = options.config ?? getCognitoConfig();
  const decoded = jwt.decode(trimmed, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header?.kid) {
    unauthorizedToken('malformed_jwt');
  }

  const unverified =
    decoded.payload && typeof decoded.payload === 'object'
      ? (decoded.payload as jwt.JwtPayload)
      : undefined;
  const peekTokenUse = asString(unverified?.token_use);
  const peekClientId =
    asString(unverified?.client_id) ?? asString(unverified?.aud);
  const peekIssuer = asString(unverified?.iss);

  const cache = options.jwksCache ?? getJwksCache(config.jwksUri);
  let pem: string;
  try {
    pem = await cache.getPem(decoded.header.kid);
  } catch {
    unauthorizedToken('jwks_key_missing', {
      tokenUse: peekTokenUse,
      clientId: peekClientId,
      issuer: peekIssuer,
      kid: decoded.header.kid,
    });
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(trimmed, pem, {
      algorithms: ['RS256'],
      issuer: config.issuer,
      clockTolerance: 5,
    }) as jwt.JwtPayload;
  } catch {
    unauthorizedToken('signature_or_expiry', {
      tokenUse: peekTokenUse,
      clientId: peekClientId,
      issuer: peekIssuer,
    });
  }

  const issuer = asString(payload.iss);
  if (!issuer || !issuerMatchesPool(issuer, config)) {
    unauthorizedToken('issuer_mismatch', {
      tokenUse: asString(payload.token_use),
      clientId: asString(payload.client_id) ?? asString(payload.aud),
      issuer,
      expectedIssuer: config.issuer,
    });
  }

  if (!audienceMatches(payload, config.appClientId)) {
    unauthorizedToken('client_mismatch', {
      tokenUse: asString(payload.token_use),
      clientId: asString(payload.client_id) ?? asString(payload.aud),
      expectedClientId: config.appClientId,
    });
  }

  const sub = asString(payload.sub);
  if (!sub) {
    unauthorizedToken('missing_sub', {
      tokenUse: asString(payload.token_use),
    });
  }

  const parsedRoles = parseAccessTokenRolesClaim(payload.roles);
  if (!parsedRoles.ok) {
    unauthorizedToken('invalid_roles_claim', {
      tokenUse: asString(payload.token_use),
    });
  }
  if (parsedRoles.roles) {
    payload.roles = parsedRoles.roles;
  }

  const tokenUse = asString(payload.token_use);
  if (options.expectedTokenUse) {
    if (tokenUse !== options.expectedTokenUse) {
      unauthorizedToken('token_use_mismatch', {
        tokenUse,
        expectedTokenUse: options.expectedTokenUse,
        clientId: asString(payload.client_id) ?? asString(payload.aud),
      });
    }
  } else if (tokenUse && tokenUse !== 'access' && tokenUse !== 'id') {
    unauthorizedToken('token_use_unsupported', { tokenUse });
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
