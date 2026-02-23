// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: JWT Lambda Authorizer
// TYPE:     TOKEN-based Lambda Authorizer (API Gateway)
// PROTECTS: All routes with Auth: JwtAuthorizer in template.yaml
//
// FLOW:
//   1. API Gateway calls this before every protected Lambda
//   2. We extract the JWT from the Authorization: Bearer <token> header
//   3. Verify JWT signature + expiry + issuer + audience
//   4. Check session is not revoked in DynamoDB (extra safety layer)
//   5. Return IAM Allow/Deny policy + inject claims into context
//      (downstream Lambdas can read context.authorizer.patientId etc.)
// ─────────────────────────────────────────────────────────────────────────────

import {
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerResult,
  Context,
  PolicyDocument,
  Statement,
} from "aws-lambda";
import { JwtPayload, SessionRecord, AuthorizerContext } from "../../types";
import { getItem, Tables } from "../../utils/dynamodb";
import { verifyAccessToken, extractBearerToken } from "../../utils/jwt";
import { createLogger } from "../../utils/logger";

const logger = createLogger("JwtAuthorizer");

export const handler = async (
  event: APIGatewayTokenAuthorizerEvent,
  context: Context
): Promise<APIGatewayAuthorizerResult> => {
  logger.setRequestId(context.awsRequestId);
  logger.debug("JwtAuthorizer invoked", { methodArn: event.methodArn });

  const methodArn = event.methodArn;

  try {
    // ── Step 1: Extract Bearer token ──────────────────────────────────────────
    const token = extractBearerToken(event.authorizationToken);

    if (!token) {
      logger.warn("Missing or malformed Authorization header");
      throw new Error("Unauthorized");   // API GW converts this to 401
    }

    // ── Step 2: Verify JWT (signature, expiry, iss, aud) ─────────────────────
    let payload: JwtPayload;
    try {
      payload = verifyAccessToken(token);
    } catch (jwtError) {
      logger.warn("JWT verification failed", { error: jwtError });
      throw new Error("Unauthorized");
    }

    // ── Step 3: Check session is still active in DynamoDB ────────────────────
    // This catches revoked sessions even if the JWT hasn't expired yet
    const session = await getItem<SessionRecord>(Tables.SESSIONS, {
      sessionId: payload.sub,
    });

    if (!session) {
      logger.warn("Session not found in DynamoDB", { sessionId: payload.sub });
      throw new Error("Unauthorized");
    }

    if (session.isRevoked) {
      logger.warn("Session is revoked", { sessionId: payload.sub });
      throw new Error("Unauthorized");
    }

    // ── Step 4: Build IAM Allow policy ────────────────────────────────────────
    const authorizerContext: AuthorizerContext = {
      sessionId: payload.sub,
      hmsClientId: payload.hmsClientId,
      patientId: payload.patientId,
      userId: payload.userId,
      role: payload.role,
      scopes: payload.scopes.join(","),
    };

    logger.info("Authorization successful", {
      sessionId: payload.sub,
      hmsClientId: payload.hmsClientId,
      patientId: payload.patientId,
      role: payload.role,
    });

    return generatePolicy(payload.sub, "Allow", methodArn, authorizerContext);
  } catch (error) {
    // Any error → Deny (API Gateway will return 401 or 403)
    if (error instanceof Error && error.message === "Unauthorized") {
      throw error;   // Re-throw so API GW returns 401
    }
    logger.error("Unexpected error in JwtAuthorizer", error);
    throw new Error("Unauthorized");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// IAM Policy Builder
// ─────────────────────────────────────────────────────────────────────────────

function generatePolicy(
  principalId: string,
  effect: "Allow" | "Deny",
  resource: string,
  context?: AuthorizerContext
): APIGatewayAuthorizerResult {
  const statement: Statement = {
    Action: "execute-api:Invoke",
    Effect: effect,
    Resource: resource,
  };

  const policyDocument: PolicyDocument = {
    Version: "2012-10-17",
    Statement: [statement],
  };

  const authResponse: APIGatewayAuthorizerResult = {
    principalId,
    policyDocument,
  };

  // Pass claims into downstream Lambda's event.requestContext.authorizer
  if (context) {
    authResponse.context = context as unknown as Record<string, string | number | boolean>;
  }

  return authResponse;
}
