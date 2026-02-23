/**
 * Custom Lambda JWT Authorizer
 * ─────────────────────────────
 * This is a TOKEN-type Lambda authorizer for API Gateway.
 * It is called BEFORE the target Lambda function and must return an
 * IAM policy document that either allows or denies access.
 *
 * How it works:
 *   1. API Gateway extracts the token from the `Authorization` header.
 *   2. This function verifies the token's signature, expiry, issuer, and audience
 *      using `aws-jwt-verify` against the Cognito JWKS endpoint.
 *   3. On success → returns an "Allow" IAM policy + context claims.
 *   4. On failure → returns a "Deny" policy OR throws "Unauthorized"
 *      (which produces a 401 from API Gateway).
 *
 * Why use a custom authorizer instead of the built-in Cognito authorizer?
 *   • Inject custom claims (e.g. roles, tenant IDs) into the Lambda context.
 *   • Add extra business-logic checks (e.g. check a deny-list, rate limiting).
 *   • Handle multiple token types or multiple User Pools.
 *
 * The built-in Cognito User Pool authorizer (used on /api/profile) is simpler
 * and preferred when you only need standard JWT validation.
 */

import type {
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerResult,
  IamPolicyDocument,
} from "../../types";
import { getCognitoConfig } from "../../services/cognitoService";
import { verifyAccessToken } from "../../services/tokenService";
import { createLogger } from "../../utils/logger";

const logger = createLogger("JwtAuthorizer");

// ─── IAM Policy builder ───────────────────────────────────────────────────────

function buildIamPolicy(
  principalId: string,
  effect: "Allow" | "Deny",
  resource: string,
  context: Record<string, string> = {}
): APIGatewayAuthorizerResult {
  const policyDocument: IamPolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      {
        Action: "execute-api:Invoke",
        Effect: effect,
        Resource: resource,
      },
    ],
  };

  return {
    principalId,
    policyDocument,
    context, // Available in downstream Lambda as event.requestContext.authorizer
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayTokenAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  logger.info("JWT authorizer invoked", {
    methodArn: event.methodArn,
  });

  const { authorizationToken, methodArn } = event;

  // ── 1. Extract the Bearer token ───────────────────────────────────────────
  if (!authorizationToken) {
    logger.warn("No authorization token present");
    // Throwing "Unauthorized" triggers a 401 response from API Gateway
    throw new Error("Unauthorized");
  }

  const parts = authorizationToken.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    logger.warn("Authorization header is not in Bearer format");
    throw new Error("Unauthorized");
  }

  const token = parts[1];

  // ── 2. Verify the token against Cognito JWKS ──────────────────────────────
  try {
    const config = getCognitoConfig();
    const payload = await verifyAccessToken(token, config);

    logger.info("Token verified — granting access", {
      sub: payload.sub,
      username: payload["cognito:username"],
      tokenUse: payload.token_use,
    });

    // ── 3. Build an Allow policy with user claims in the context ─────────────
    //   These values are available downstream as:
    //   event.requestContext.authorizer.userId  etc.
    const context: Record<string, string> = {
      userId: payload.sub,
      email: payload.email ?? "",
      username: payload["cognito:username"] ?? payload.sub,
      groups: (payload["cognito:groups"] ?? []).join(","),
      tokenUse: payload.token_use,
    };

    return buildIamPolicy(payload.sub, "Allow", methodArn, context);
  } catch (err) {
    logger.warn("Token verification failed — denying access", {
      error: err instanceof Error ? err.message : String(err),
    });

    // Throwing "Unauthorized" → 401; returning a Deny policy → 403
    // Choose based on your application's UX requirements.
    throw new Error("Unauthorized");
  }
};
