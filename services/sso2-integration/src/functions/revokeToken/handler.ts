// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: Revoke Token (Logout)
// ROUTE:    POST /auth/revoke
// AUTH:     JWT required (Lambda Authorizer)
//
// FLOW:
//   1. Authenticated user sends JWT (or requests revoking all sessions)
//   2. We mark the session as revoked in DynamoDB
//   3. Subsequent JWT validations will see isRevoked=true and deny access
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { RevokeTokenRequest, AuthorizerContext } from "../../types";
import { updateItem, Tables } from "../../utils/dynamodb";
import { successResponse, Responses } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("RevokeToken");

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(context.awsRequestId);

  try {
    // ── Extract session info from Lambda Authorizer context ───────────────────
    const authContext = event.requestContext.authorizer as AuthorizerContext;
    const currentSessionId = authContext?.sessionId;

    if (!currentSessionId) {
      return Responses.unauthorized("No active session found", context.awsRequestId);
    }

    // ── Parse optional body ───────────────────────────────────────────────────
    let body: RevokeTokenRequest = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body) as RevokeTokenRequest;
      } catch {
        return Responses.badRequest("Invalid JSON in request body", context.awsRequestId);
      }
    }

    // ── Revoke the session ────────────────────────────────────────────────────
    const sessionIdToRevoke = body.sessionId ?? currentSessionId;
    const now = new Date().toISOString();

    await updateItem(
      Tables.SESSIONS,
      { sessionId: sessionIdToRevoke },
      {
        isRevoked: true,
        revokedAt: now,
      }
    );

    logger.info("Session revoked", {
      revokedSessionId: sessionIdToRevoke,
      requestedBy: currentSessionId,
    });

    return successResponse({ message: "Session revoked successfully", sessionId: sessionIdToRevoke });
  } catch (error) {
    logger.error("Unexpected error in RevokeToken", error);
    return Responses.internalError(context.awsRequestId);
  }
};
