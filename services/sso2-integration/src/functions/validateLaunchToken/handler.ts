// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: Validate Launch Token  (Token Exchange)
// ROUTE:    POST /auth/exchange
// AUTH:     None — the launch_token IS the proof of identity
//
// FLOW:
//   1. MyVitalRx frontend sends the launch_token it received in the URL param
//   2. We look up the token in DynamoDB
//   3. Validate: exists, not expired (TTL), not already used
//   4. Mark token as used (one-time use — prevents replay attacks)
//   5. Create a new Session record in SessionsTable
//   6. Sign a JWT access token from the session
//   7. Return { access_token, refresh_token, scopes, patientContext, userContext }
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import {
  ExchangeLaunchTokenRequest,
  ExchangeLaunchTokenResponse,
  LaunchTokenRecord,
  SessionRecord,
} from "../../types";
import { getItem, putItem, updateItem, Tables } from "../../utils/dynamodb";
import {
  generateUUID,
  generateRefreshToken,
  futureEpoch,
  isNotExpired,
  nowSeconds,
} from "../../utils/token";
import { signAccessToken } from "../../utils/jwt";
import { successResponse, Responses } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("ValidateLaunchToken");

const JWT_EXPIRY = parseInt(process.env["JWT_EXPIRY"] ?? "3600", 10);
const REFRESH_TOKEN_EXPIRY = parseInt(process.env["REFRESH_TOKEN_EXPIRY"] ?? "86400", 10);

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(context.awsRequestId);
  logger.info("ValidateLaunchToken invoked");

  try {
    // ── Step 1: Parse request body ────────────────────────────────────────────
    if (!event.body) {
      return Responses.badRequest("Request body is required", context.awsRequestId);
    }

    let body: ExchangeLaunchTokenRequest;
    try {
      body = JSON.parse(event.body) as ExchangeLaunchTokenRequest;
    } catch {
      return Responses.badRequest("Invalid JSON in request body", context.awsRequestId);
    }

    const { launchToken } = body;

    if (!launchToken || typeof launchToken !== "string" || launchToken.trim() === "") {
      return Responses.badRequest("launchToken is required", context.awsRequestId);
    }

    // ── Step 2: Look up the launch token in DynamoDB ──────────────────────────
    const tokenRecord = await getItem<LaunchTokenRecord>(Tables.LAUNCH_TOKENS, {
      launchToken: launchToken.trim(),
    });

    if (!tokenRecord) {
      logger.warn("Launch token not found", { launchToken: maskToken(launchToken) });
      return Responses.unauthorized("Invalid launch token", context.awsRequestId);
    }

    // ── Step 3a: Check if already used (replay attack prevention) ────────────
    if (tokenRecord.used) {
      logger.warn("Launch token already used (potential replay attack)", {
        launchToken: maskToken(launchToken),
        hmsClientId: tokenRecord.hmsClientId,
      });
      return Responses.gone(
        "Launch token has already been used. Please initiate a new SSO session from HMS.",
        context.awsRequestId
      );
    }

    // ── Step 3b: Check if token has expired ───────────────────────────────────
    // DynamoDB TTL deletion is eventually consistent; we do a hard check here
    if (!isNotExpired(tokenRecord.ttl)) {
      logger.warn("Launch token expired", {
        launchToken: maskToken(launchToken),
        ttl: tokenRecord.ttl,
        now: nowSeconds(),
      });
      return Responses.gone(
        "Launch token has expired. Please initiate a new SSO session from HMS.",
        context.awsRequestId
      );
    }

    // ── Step 4: Mark token as used (atomic update) ────────────────────────────
    // This MUST happen before we create the session to prevent race conditions
    await updateItem(Tables.LAUNCH_TOKENS, { launchToken }, {
      used: true,
      usedAt: new Date().toISOString(),
    });

    logger.info("Launch token consumed", {
      hmsClientId: tokenRecord.hmsClientId,
      patientId: tokenRecord.patientContext.patientId,
    });

    // ── Step 5: Create a Session record ───────────────────────────────────────
    const sessionId = generateUUID();
    const refreshToken = generateRefreshToken();
    const now = new Date().toISOString();

    const session: SessionRecord = {
      sessionId,
      refreshToken,
      hmsClientId: tokenRecord.hmsClientId,
      patientContext: tokenRecord.patientContext,
      userContext: tokenRecord.userContext,
      scopes: tokenRecord.scopes,
      isRevoked: false,
      createdAt: now,
      lastUsedAt: now,
      ttl: futureEpoch(REFRESH_TOKEN_EXPIRY),
    };

    await putItem(Tables.SESSIONS, session);

    // ── Step 6: Sign JWT access token ─────────────────────────────────────────
    const accessToken = signAccessToken(session);

    // ── Step 7: Build and return response ─────────────────────────────────────
    const response: ExchangeLaunchTokenResponse = {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: JWT_EXPIRY,
      scopes: tokenRecord.scopes,
      patientContext: tokenRecord.patientContext,
      userContext: tokenRecord.userContext,
    };

    logger.info("SSO exchange successful", {
      sessionId,
      hmsClientId: tokenRecord.hmsClientId,
      patientId: tokenRecord.patientContext.patientId,
      userId: tokenRecord.userContext.userId,
      scopes: tokenRecord.scopes,
    });

    return successResponse(response, 200);
  } catch (error) {
    logger.error("Unexpected error in ValidateLaunchToken", error);
    return Responses.internalError(context.awsRequestId);
  }
};

/** Mask a token for safe logging (show only first 8 chars) */
function maskToken(token: string): string {
  return token.substring(0, 8) + "****";
}
