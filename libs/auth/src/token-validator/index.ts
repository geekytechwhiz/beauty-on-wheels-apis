/**
 * Token validator for Lambda Authorizer.
 * Validates JWT signature (JWKS), iss, aud, token_use, exp.
 * Extracts sub, client_id, tenant_id, scopes, SMART claims.
 * Does NOT call external APIs (except JWKS fetch when uncached).
 */

import * as jwt from 'jsonwebtoken';
import type { VerifiedPayload, AuthorizerContext, SmartContext } from '../types';
import { getPemsForJwksUrl, getCognitoJwksUrl } from '../jwks-cache';
import { parseScopes } from '../scope-parser';

/** Custom claim key for tenant ID (Cognito custom attribute). */
const TENANT_ID_CLAIM = 'custom:tenant_id';

/** Alternative tenant claim some issuers use. */
const TENANT_ID_ALT = 'tenant_id';

/** Legacy custom claims. */
const CUSTOM_USER_ID = 'custom:userID';
const CUSTOM_ORG_ID = 'custom:organizationID';

export interface TokenValidatorConfig {
  /** Cognito User Pool ID (used to build JWKS URL and validate iss). */
  userPoolId: string;
  /** AWS region for Cognito. */
  region: string;
  /** Expected audience (client id or resource server). Skip audience check when empty array and allowLegacyToken. */
  expectedAudience: string | string[];
  /** Optional: override JWKS URL (otherwise derived from userPoolId + region). */
  jwksUrl?: string;
  /** When true: tenant_id optional (use custom:organizationID); token_use optional; audience optional if empty. */
  allowLegacyToken?: boolean;
}

export class TokenValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'UNAUTHORIZED' | 'INVALID_TOKEN' | 'MISSING_CLAIM'
  ) {
    super(message);
    this.name = 'TokenValidationError';
  }
}

/**
 * Verifies JWT signature and issuer with PEM; audience is validated after decode.
 */
async function verifyWithPem(
  token: string,
  pem: string,
  options: { issuer: string }
): Promise<VerifiedPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      pem,
      {
        algorithms: ['RS256'],
        issuer: options.issuer,
        complete: false,
      },
      (err: jwt.VerifyErrors | null, decoded: unknown) => {
        if (err) {
          reject(new TokenValidationError('JWT verification failed', 'INVALID_TOKEN'));
          return;
        }
        if (!decoded || typeof decoded !== 'object') {
          reject(new TokenValidationError('Invalid payload', 'INVALID_TOKEN'));
          return;
        }
        resolve(decoded as VerifiedPayload);
      }
    );
  });
}

/**
 * Extracts SMART on FHIR context from payload (patient, fhirUser, encounter).
 */
function extractSmartContext(payload: VerifiedPayload): SmartContext {
  const patient =
    typeof payload.patient === 'string'
      ? payload.patient
      : undefined;
  const fhirUser =
    typeof payload.fhirUser === 'string'
      ? payload.fhirUser
      : undefined;
  const encounter =
    typeof payload.encounter === 'string'
      ? payload.encounter
      : undefined;
  return { patient, fhirUser, encounter };
}

/**
 * Validates access token and returns authorizer context.
 * Throws TokenValidationError on validation failure.
 */
export async function validateAccessToken(
  token: string,
  config: TokenValidatorConfig
): Promise<AuthorizerContext> {
  const jwksUrl =
    config.jwksUrl ??
    getCognitoJwksUrl(config.userPoolId, config.region);
  const pems = await getPemsForJwksUrl(jwksUrl);

  // Decode header only to get kid (no security decision from decode).
  const decoded = jwt.decode(token, { complete: true });
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !decoded.header ||
    !decoded.header.kid
  ) {
    throw new TokenValidationError('Invalid token structure', 'INVALID_TOKEN');
  }

  const pem = pems[decoded.header.kid as string];
  if (!pem) {
    throw new TokenValidationError('Unknown key id', 'INVALID_TOKEN');
  }

  // Cognito issuer format.
  const expectedIssuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  const audience = Array.isArray(config.expectedAudience)
    ? config.expectedAudience
    : [config.expectedAudience];

  const payload = await verifyWithPem(token, pem, { issuer: expectedIssuer });

  const allowLegacy = config.allowLegacyToken === true;

  // Validate audience (payload.aud can be string or string[]). Skip when legacy and no expected audience.
  if (audience.length > 0) {
    const tokenAud = payload.aud;
    const tokenAudList = Array.isArray(tokenAud) ? tokenAud : tokenAud ? [tokenAud] : [];
    const audienceMatches = audience.some((expected) => tokenAudList.includes(expected));
    if (!audienceMatches) {
      throw new TokenValidationError('Audience not allowed', 'INVALID_TOKEN');
    }
  }

  // Reject ID tokens in non-legacy mode; in legacy mode token_use may be absent.
  const tokenUse = payload.token_use;
  if (!allowLegacy && tokenUse !== 'access') {
    throw new TokenValidationError('Token must be access token', 'INVALID_TOKEN');
  }
  if (allowLegacy && tokenUse != null && tokenUse !== 'access') {
    throw new TokenValidationError('Token must be access token', 'INVALID_TOKEN');
  }

  const sub = payload.sub;
  if (!sub || typeof sub !== 'string') {
    throw new TokenValidationError('Missing sub', 'MISSING_CLAIM');
  }

  const tenantIdClaim =
    (payload[TENANT_ID_CLAIM] as string | undefined) ??
    (payload[TENANT_ID_ALT] as string | undefined);
  const organizationIDLegacy = payload[CUSTOM_ORG_ID] as string | undefined;
  const tenantId = tenantIdClaim?.trim() ?? organizationIDLegacy?.trim() ?? '';
  if (!tenantId && !allowLegacy) {
    throw new TokenValidationError('Missing tenant_id', 'MISSING_CLAIM');
  }
  if (!tenantId && allowLegacy) {
    throw new TokenValidationError('Missing tenant_id or organizationID', 'MISSING_CLAIM');
  }

  const clientId =
    typeof payload.client_id === 'string'
      ? payload.client_id
      : '';

  const scopes = parseScopes(payload.scope);
  const smart = extractSmartContext(payload);
  const userID = payload[CUSTOM_USER_ID] as string | undefined;
  const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : undefined;

  return {
    sub,
    clientId,
    scopes,
    tenantId: tenantId.trim(),
    patient: smart.patient,
    fhirUser: smart.fhirUser,
    encounter: smart.encounter,
    ...(userID != null && userID !== '' && { userID }),
    ...(organizationIDLegacy != null && organizationIDLegacy !== '' && { organizationID: organizationIDLegacy.trim() }),
    ...(authTime != null && { authTime }),
  };
}
