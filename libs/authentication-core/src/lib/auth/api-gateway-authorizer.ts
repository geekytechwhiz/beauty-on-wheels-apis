import { createLogger } from '@api-hub/observability';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type { AuthContext, AuthenticateOptions } from './auth-context';
import { authenticate } from './authenticate';
import {
  toAuthorizerContext,
} from './authorizer-context';

export type AuthorizerEffect = 'Allow' | 'Deny';

export interface AuthorizerIamStatement {
  Action: string;
  Effect: AuthorizerEffect;
  Resource: string;
}

export interface AuthorizerIamPolicy {
  principalId: string;
  policyDocument: {
    Version: '2012-10-17';
    Statement: AuthorizerIamStatement[];
  };
  context?: Record<string, string>;
}

export interface TokenAuthorizerEvent {
  type?: string;
  authorizationToken?: string;
  methodArn: string;
  headers?: Record<string, string | undefined>;
}

export type EvaluateAuthorizerOptions = AuthenticateOptions;

const logger = createLogger({
  service: 'api-gateway-authorizer',
  redactPII: true,
});

/** API Gateway maps this exact error message to HTTP 401 Unauthorized. */
export const API_GATEWAY_UNAUTHORIZED = 'Unauthorized';

/**
 * TOKEN authorizer cache is keyed by the token. Return a stage-wide resource
 * so a cached Allow is valid for every method on that API stage.
 *
 * execute-api ARNs are api-id/stage/verb/path. A single trailing star can miss
 * GET/me; verb-and-path wildcards (star/star) cover both segments.
 */
export function toExecuteApiWildcardResource(methodArn: string): string {
  const trimmed = methodArn?.trim();
  if (!trimmed) {
    return '*';
  }
  const parts = trimmed.split('/');
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}/*/*`;
  }
  return trimmed;
}

export function buildIamPolicy(
  principalId: string,
  effect: AuthorizerEffect,
  methodArn: string,
  context?: Record<string, string>,
): AuthorizerIamPolicy {
  const policy: AuthorizerIamPolicy = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: toExecuteApiWildcardResource(methodArn),
        },
      ],
    },
  };
  if (context && Object.keys(context).length > 0) {
    policy.context = context;
  }
  return policy;
}

function authorizerRequest(authorizationToken?: string): LambdaRequest {
  return {
    event: {} as LambdaRequest['event'],
    params: {},
    body: {},
    context: {
      correlationId: '',
      awsRequestId: '',
      logger: {},
      authHeader: authorizationToken,
    },
  };
}

function readAuthorizerToken(event: TokenAuthorizerEvent): string | undefined {
  const direct = event.authorizationToken?.trim();
  if (direct) {
    return direct;
  }
  return event.headers?.Authorization?.trim() || event.headers?.authorization?.trim();
}

function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const status = (err as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function throwGatewayUnauthorized(): never {
  throw new Error(API_GATEWAY_UNAUTHORIZED);
}

/**
 * Validates a Cognito JWT, resolves identity → user → roles → permissions,
 * and returns an API Gateway IAM policy. Never inspects client-supplied identity headers.
 *
 * Invalid/missing tokens throw `"Unauthorized"` (API Gateway 401). Authenticated
 * callers without an application user mapping receive an IAM Deny (403). Returning
 * Deny for invalid tokens produces the opaque gateway message
 * "explicit deny in an identity-based policy".
 */
export async function evaluateApiGatewayAuthorizer(
  event: TokenAuthorizerEvent,
  options: EvaluateAuthorizerOptions = {},
): Promise<AuthorizerIamPolicy> {
  try {
    const ctx: AuthContext = await authenticate(
      authorizerRequest(readAuthorizerToken(event)),
      {
        userDirectory: options.userDirectory,
        requireApplicationUser: options.requireApplicationUser ?? true,
        expectedTokenUse: options.expectedTokenUse,
      },
    );
    const policyResource = toExecuteApiWildcardResource(event.methodArn);
    logger.info({
      event: 'authorizer_allowed',
      identityId: ctx.identityId,
      userId: ctx.userId,
      tokenUse:
        typeof ctx.claims.token_use === 'string' ? ctx.claims.token_use : undefined,
      methodArn: event.methodArn,
      policyResource,
      effect: 'Allow',
    });
    return buildIamPolicy(
      ctx.identityId,
      'Allow',
      event.methodArn,
      toAuthorizerContext(ctx),
    );
  } catch (err) {
    const status = errorStatus(err);
    const code = errorCode(err) ?? (err instanceof Error ? err.name : undefined);
    const metadata =
      err instanceof BaseError ? err.metadata : undefined;
    logger.warn({
      event: 'authorizer_denied',
      statusCode: status,
      code,
      identityId:
        typeof metadata?.identityId === 'string' ? metadata.identityId : undefined,
      tokenUse:
        typeof metadata?.tokenUse === 'string' ? metadata.tokenUse : undefined,
      methodArn: event.methodArn,
      policyResource: toExecuteApiWildcardResource(event.methodArn),
      hasToken: Boolean(readAuthorizerToken(event)),
    });

    if (status === 403 || (err instanceof BaseError && err.code === 'APPLICATION_USER_NOT_FOUND')) {
      return buildIamPolicy('unauthorized', 'Deny', event.methodArn);
    }

    throwGatewayUnauthorized();
  }
}
