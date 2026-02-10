/**
 * Lambda Token Authorizer (API Gateway).
 * Supports:
 * - New flow: OAuth2/SMART (JWKS, iss, aud, token_use, tenant_id, scopes).
 * - Legacy flow: Cognito + Secrets Manager (cached) + user details (DynamoDB) + OTP send + legacy context (email, phoneNumber, userID, organizationID, userType, defaultProfile, randomId).
 * Existing consumers keep full functionality including OTP sending and same context shape.
 */

import type {
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerResult,
  APIGatewayAuthorizerResultContext,
} from 'aws-lambda';
import {
  validateAccessToken,
  TokenValidationError,
  type AuthorizerContext,
} from '@api-hub/auth';
import * as jwt from 'jsonwebtoken';
import {
  getLegacySecrets,
  getUserDetails,
  isLegacySessionValid,
  sendOtpFireAndForget,
  generateRandomIdWithTimestamp,
} from './legacy';

const BEARER_PREFIX = /^Bearer\s+/i;

/** Resolved config: pool from env or secrets; audience optional in legacy. */
interface ResolvedConfig {
  userPoolId: string;
  region: string;
  expectedAudience: string[];
  allowLegacyToken: boolean;
  userTable: string;
  secretManagerName: string;
  endUserMessagingUrl: string;
}

function getConfig(): ResolvedConfig {
  const region = process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  const userPoolIdEnv = (process.env.COGNITO_USER_POOL_ID ?? '').trim();
  const secretManagerName = (process.env.SECRET_MANAGER_NAME ?? '').trim();
  const userTable = (process.env.USER_TABLE ?? '').trim();
  const endUserMessagingUrl = (process.env.END_USER_MESSAGING_URL ?? '').trim();
  const audienceEnv = (process.env.EXPECTED_AUDIENCE ?? process.env.COGNITO_CLIENT_ID ?? '').trim();

  const allowLegacyToken = Boolean(secretManagerName && userTable);
  let userPoolId = userPoolIdEnv;
  if (!userPoolId && allowLegacyToken) {
    userPoolId = ''; // will be resolved from secrets in handler
  }
  const expectedAudience = audienceEnv
    ? (audienceEnv.includes(',') ? audienceEnv.split(',').map((a) => a.trim()).filter(Boolean) : [audienceEnv])
    : [];

  return {
    userPoolId,
    region,
    expectedAudience,
    allowLegacyToken,
    userTable,
    secretManagerName,
    endUserMessagingUrl,
  };
}

/**
 * Resolves user pool ID: from env or from cached Secrets Manager (legacy).
 */
async function resolveUserPoolId(config: ResolvedConfig): Promise<string> {
  if (config.userPoolId) {
    return config.userPoolId;
  }
  if (config.secretManagerName) {
    const secrets = await getLegacySecrets(config.secretManagerName);
    const poolId = secrets.USER_POOL_ID?.trim();
    if (poolId) return poolId;
  }
  throw new Error('USER_POOL_ID not found (env or secrets)');
}

/**
 * API Gateway authorizer context: legacy + new fields (all strings).
 */
function toContextMap(
  ctx: AuthorizerContext,
  legacy: {
    email: string;
    phoneNumber: string;
    userID: string;
    organizationID: string;
    userType: string;
    defaultProfile: string;
    randomId: string;
  } | null
): APIGatewayAuthorizerResultContext {
  const out: APIGatewayAuthorizerResultContext = {
    sub: ctx.sub,
    clientId: ctx.clientId,
    scopes: JSON.stringify(ctx.scopes),
    tenantId: ctx.tenantId,
  };
  if (ctx.patient != null) out.patient = ctx.patient;
  if (ctx.fhirUser != null) out.fhirUser = ctx.fhirUser;
  if (ctx.encounter != null) out.encounter = ctx.encounter;
  if (legacy != null) {
    out.email = legacy.email;
    out.phoneNumber = legacy.phoneNumber;
    out.userID = legacy.userID;
    out.organizationID = legacy.organizationID;
    out.userType = legacy.userType;
    out.defaultProfile = legacy.defaultProfile;
    out.randomId = legacy.randomId;
  }
  return out;
}

function allowPolicy(
  principalId: string,
  methodArn: string,
  context: APIGatewayAuthorizerResultContext
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        { Action: 'execute-api:Invoke', Effect: 'Allow', Resource: methodArn },
      ],
    },
    context,
  };
}

function denyPolicy(principalId: string, methodArn: string): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        { Action: 'execute-api:Invoke', Effect: 'Deny', Resource: methodArn },
      ],
    },
  };
}

export async function main(
  event: APIGatewayTokenAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  const methodArn = event.methodArn;
  const rawToken = event.authorizationToken ?? '';

  if (!rawToken || !BEARER_PREFIX.test(rawToken)) {
    return denyPolicy('unauthorized', methodArn);
  }

  const token = rawToken.replace(BEARER_PREFIX, '').trim();
  if (!token) {
    return denyPolicy('unauthorized', methodArn);
  }

  const config = getConfig();
  let userPoolId: string;
  try {
    userPoolId = await resolveUserPoolId(config);
  } catch (err) {
    console.warn('Authorizer config error:', err instanceof Error ? err.message : 'resolve pool failed');
    return denyPolicy('unauthorized', methodArn);
  }

  const allowLegacy = config.allowLegacyToken;

  let ctx: AuthorizerContext;
  try {
    ctx = await validateAccessToken(token, {
      userPoolId,
      region: config.region,
      expectedAudience: config.expectedAudience,
      allowLegacyToken: allowLegacy,
    });
  } catch (err) {
    if (err instanceof TokenValidationError) {
      console.warn('Token validation failed', { code: err.code, message: err.message });
    } else {
      console.warn('Authorizer error', { message: err instanceof Error ? err.message : String(err) });
    }
    return denyPolicy('unauthorized', methodArn);
  }

  let legacyContext: {
    email: string;
    phoneNumber: string;
    userID: string;
    organizationID: string;
    userType: string;
    defaultProfile: string;
    randomId: string;
  } | null = null;

  if (allowLegacy && config.userTable && ctx.userID && ctx.organizationID) {
    const userDetails = await getUserDetails(config.userTable, ctx.userID, ctx.organizationID);
    if (!isLegacySessionValid(userDetails, ctx.authTime)) {
      return denyPolicy('unauthorized', methodArn);
    }
    if (userDetails != null) {
      legacyContext = {
        email: userDetails.emailAddress ?? '',
        phoneNumber: userDetails.phoneNumber ?? '',
        userID: userDetails.userID,
        organizationID: userDetails.organizationID,
        userType: userDetails.userType ?? '',
        defaultProfile: userDetails.defaultProfile ?? '',
        randomId: generateRandomIdWithTimestamp(),
      };
      // OTP: fire-and-forget so existing consumer functionality is preserved (legacy sent OTP on every auth)
      const phoneFromUser = userDetails.phoneNumber?.trim();
      if (phoneFromUser) {
        sendOtpFireAndForget(config.endUserMessagingUrl, phoneFromUser);
      } else {
        try {
          const decoded = jwt.decode(token) as { phone_number?: string } | null;
          const tokenPhone = decoded?.phone_number;
          if (typeof tokenPhone === 'string' && tokenPhone.trim()) {
            sendOtpFireAndForget(config.endUserMessagingUrl, tokenPhone.trim());
          }
        } catch {
          // ignore
        }
      }
    }
  }

  const contextMap = toContextMap(ctx, legacyContext);
  const principalId = legacyContext != null ? 'USER' : ctx.sub;
  return allowPolicy(principalId, methodArn, contextMap);
}
