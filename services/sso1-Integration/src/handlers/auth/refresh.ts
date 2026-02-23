/**
 * Refresh Token Handler
 * ─────────────────────
 * POST /auth/refresh
 * Content-Type: application/json
 * Body: { "refreshToken": "<refresh_token>" }
 *
 * Issues a new access token and ID token using a valid refresh token.
 * The refresh token itself is NOT rotated — Cognito keeps the same one
 * unless token rotation is enabled in your User Pool client.
 *
 * Security considerations:
 *   • Refresh tokens are long-lived (default: 30 days). Store them securely
 *     (HttpOnly cookies, encrypted storage — never localStorage).
 *   • Implement token rotation on the client and revoke refresh tokens on logout.
 */

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  RefreshTokenBody,
} from "../../types";
import { getCognitoConfig, refreshAccessToken } from "../../services/cognitoService";
import { ok, badRequest, unauthorized, internalServerError } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("RefreshHandler");

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(event.requestContext?.requestId ?? "unknown");
  logger.info("Refresh token handler invoked");

  try {
    // ── 1. Parse and validate request body ────────────────────────────────────
    if (!event.body) {
      return badRequest("MISSING_BODY", "Request body is required");
    }

    let body: Partial<RefreshTokenBody>;
    try {
      body = JSON.parse(event.body) as Partial<RefreshTokenBody>;
    } catch {
      return badRequest("INVALID_JSON", "Request body must be valid JSON");
    }

    const { refreshToken } = body;
    if (!refreshToken || typeof refreshToken !== "string" || refreshToken.trim() === "") {
      return badRequest(
        "MISSING_REFRESH_TOKEN",
        "refreshToken is required in the request body"
      );
    }

    // ── 2. Exchange refresh token for new access token ─────────────────────────
    const config = getCognitoConfig();

    const newTokens = await refreshAccessToken(refreshToken.trim(), config);

    logger.info("Access token refreshed successfully");

    return ok(
      {
        idToken: newTokens.idToken,
        accessToken: newTokens.accessToken,
        expiresIn: newTokens.expiresIn,
        tokenType: newTokens.tokenType,
      },
      "Access token refreshed successfully"
    );
  } catch (err) {
    logger.error("Refresh token handler failed", err);

    // Cognito returns NotAuthorizedException for expired/revoked refresh tokens
    const message = err instanceof Error ? err.message : "Token refresh failed";
    if (
      message.toLowerCase().includes("notauthorized") ||
      message.toLowerCase().includes("invalid") ||
      message.toLowerCase().includes("expired")
    ) {
      return unauthorized("Refresh token is invalid or has expired. Please log in again.");
    }

    return internalServerError(message);
  }
};
