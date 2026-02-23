// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: Refresh Token
// ROUTE:    POST /auth/refresh
// AUTH:     None — refresh_token IS the credential
//
// FLOW:
//   1. MyVitalRx sends the refresh_token (when access_token expires)
//   2. We look up the session by refreshToken via GSI
//   3. Validate: session exists, not revoked, not expired
//   4. Rotate the refresh token (issue new one — old one is invalidated)
//   5. Sign a new JWT access token
//   6. Return new { access_token, refresh_token }
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { RefreshTokenRequest, RefreshTokenResponse, SessionRecord } from "../../types";
import { queryByIndex, updateItem, Tables } from "../../utils/dynamodb";
import { generateRefreshToken, futureEpoch, isNotExpired } from "../../utils/token";
import { signAccessToken } from "../../utils/jwt";
import { successResponse, Responses } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("RefreshToken");
const JWT_EXPIRY = parseInt(process.env["JWT_EXPIRY"] ?? "3600", 10);
const REFRESH_TOKEN_EXPIRY = parseInt(process.env["REFRESH_TOKEN_EXPIRY"] ?? "86400", 10);

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(context.awsRequestId);
  logger.info("RefreshToken invoked");

  try {
    // ── Step 1: Parse & validate body ─────────────────────────────────────────
    if (!event.body) {
      return Responses.badRequest("Request body is required", context.awsRequestId);
    }

    let body: RefreshTokenRequest;
    try {
      body = JSON.parse(event.body) as RefreshTokenRequest;
    } catch {
      return Responses.badRequest("Invalid JSON in request body", context.awsRequestId);
    }

    const { refreshToken } = body;
    if (!refreshToken || typeof refreshToken !== "string") {
      return Responses.badRequest("refreshToken is required", context.awsRequestId);
    }

    // ── Step 2: Find session by refresh token (via GSI) ───────────────────────
    const sessions = await queryByIndex<SessionRecord>(
      Tables.SESSIONS,
      "RefreshTokenIndex",
      "#rt = :rt",
      { ":rt": refreshToken },
      { "#rt": "refreshToken" }
    );

    if (!sessions || sessions.length === 0) {
      logger.warn("Refresh token not found");
      return Responses.unauthorized("Invalid refresh token", context.awsRequestId);
    }

    const session = sessions[0]!;

    // ── Step 3a: Check if session is revoked ──────────────────────────────────
    if (session.isRevoked) {
      logger.warn("Attempted use of revoked session", { sessionId: session.sessionId });
      return Responses.unauthorized(
        "Session has been revoked. Please re-authenticate via HMS.",
        context.awsRequestId
      );
    }

    // ── Step 3b: Check if session has expired ─────────────────────────────────
    if (!isNotExpired(session.ttl)) {
      logger.warn("Session expired", { sessionId: session.sessionId });
      return Responses.unauthorized(
        "Session has expired. Please re-authenticate via HMS.",
        context.awsRequestId
      );
    }

    // ── Step 4: Rotate refresh token ──────────────────────────────────────────
    const newRefreshToken = generateRefreshToken();
    const now = new Date().toISOString();
    const newTtl = futureEpoch(REFRESH_TOKEN_EXPIRY);

    // Update session with new refresh token + extended TTL
    await updateItem(
      Tables.SESSIONS,
      { sessionId: session.sessionId },
      {
        refreshToken: newRefreshToken,
        lastUsedAt: now,
        ttl: newTtl,
      }
    );

    // Build updated session object for JWT signing
    const updatedSession: SessionRecord = {
      ...session,
      refreshToken: newRefreshToken,
      lastUsedAt: now,
      ttl: newTtl,
    };

    // ── Step 5: Sign new JWT access token ─────────────────────────────────────
    const newAccessToken = signAccessToken(updatedSession);

    // ── Step 6: Return response ───────────────────────────────────────────────
    const response: RefreshTokenResponse = {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenType: "Bearer",
      expiresIn: JWT_EXPIRY,
    };

    logger.info("Token refreshed successfully", {
      sessionId: session.sessionId,
      hmsClientId: session.hmsClientId,
    });

    return successResponse(response);
  } catch (error) {
    logger.error("Unexpected error in RefreshToken", error);
    return Responses.internalError(context.awsRequestId);
  }
};
