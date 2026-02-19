// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: Generate Launch Token
// ROUTE:    POST /hms/launch
// AUTH:     X-HMS-Client-Id + X-HMS-Api-Key headers (no JWT needed here)
//
// FLOW:
//   1. HMS sends patient context + user context + desired scopes
//   2. We validate HMS credentials against HmsClientsTable
//   3. We validate requested scopes against client's allowedScopes
//   4. We validate the redirect URI against client's allowedRedirectUris
//   5. We generate a one-time launch token (UUID) stored in DynamoDB (TTL: 5min)
//   6. We return the launch token + a full launch URL for HMS to redirect to
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import {
  GenerateLaunchTokenRequest,
  GenerateLaunchTokenResponse,
  HmsClientRecord,
  LaunchTokenRecord,
} from "../../types";
import { getItem, putItem, Tables } from "../../utils/dynamodb";
import { generateUUID, futureEpoch, verifyApiKey } from "../../utils/token";
import { successResponse, Responses } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("GenerateLaunchToken");

const LAUNCH_TOKEN_TTL_SECONDS = parseInt(
  process.env["LAUNCH_TOKEN_TTL"] ?? "300",
  10
);
const MYVITALRX_BASE_URL = process.env["MYVITALRX_BASE_URL"] ?? "https://app.myvitalrx.com";

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(context.awsRequestId);
  logger.info("GenerateLaunchToken invoked", { path: event.path, method: event.httpMethod });

  try {
    // ── Step 1: Extract HMS credentials from headers ──────────────────────────
    const hmsClientId = event.headers["X-HMS-Client-Id"] ?? event.headers["x-hms-client-id"];
    const hmsApiKey = event.headers["X-HMS-Api-Key"] ?? event.headers["x-hms-api-key"];

    if (!hmsClientId || !hmsApiKey) {
      logger.warn("Missing HMS credentials in headers");
      return Responses.unauthorized(
        "Missing X-HMS-Client-Id or X-HMS-Api-Key headers",
        context.awsRequestId
      );
    }

    // ── Step 2: Parse & validate request body ─────────────────────────────────
    if (!event.body) {
      return Responses.badRequest("Request body is required", context.awsRequestId);
    }

    let body: GenerateLaunchTokenRequest;
    try {
      body = JSON.parse(event.body) as GenerateLaunchTokenRequest;
    } catch {
      return Responses.badRequest("Invalid JSON in request body", context.awsRequestId);
    }

    const { patientContext, userContext, scopes, redirectUri } = body;

    if (!patientContext?.patientId) {
      return Responses.badRequest("patientContext.patientId is required", context.awsRequestId);
    }
    if (!userContext?.userId || !userContext?.username || !userContext?.role) {
      return Responses.badRequest(
        "userContext.userId, username, and role are required",
        context.awsRequestId
      );
    }
    if (!redirectUri) {
      return Responses.badRequest("redirectUri is required", context.awsRequestId);
    }

    // ── Step 3: Validate HMS client credentials ───────────────────────────────
    const hmsClient = await getItem<HmsClientRecord>(Tables.HMS_CLIENTS, {
      clientId: hmsClientId,
    });

    if (!hmsClient) {
      logger.warn("HMS client not found", { hmsClientId });
      return Responses.unauthorized("Invalid HMS client credentials", context.awsRequestId);
    }

    if (!hmsClient.isActive) {
      logger.warn("HMS client is inactive", { hmsClientId });
      return Responses.forbidden("HMS client account is disabled", context.awsRequestId);
    }

    const isValidKey = verifyApiKey(hmsApiKey, hmsClient.apiKeyHash);
    if (!isValidKey) {
      logger.warn("Invalid HMS API key", { hmsClientId });
      return Responses.unauthorized("Invalid HMS client credentials", context.awsRequestId);
    }

    // ── Step 4: Validate requested scopes ────────────────────────────────────
    const requestedScopes = scopes ?? hmsClient.allowedScopes;
    const unauthorizedScopes = requestedScopes.filter(
      (scope) => !hmsClient.allowedScopes.includes(scope)
    );
    if (unauthorizedScopes.length > 0) {
      logger.warn("Requested unauthorized scopes", { hmsClientId, unauthorizedScopes });
      return Responses.forbidden(
        `Requested scopes not allowed: ${unauthorizedScopes.join(", ")}`,
        context.awsRequestId
      );
    }

    // ── Step 5: Validate redirect URI ─────────────────────────────────────────
    if (!hmsClient.allowedRedirectUris.includes(redirectUri)) {
      logger.warn("Invalid redirect URI", { hmsClientId, redirectUri });
      return Responses.badRequest(
        `Redirect URI not registered for this HMS client: ${redirectUri}`,
        context.awsRequestId
      );
    }

    // ── Step 6: Generate launch token ─────────────────────────────────────────
    const launchToken = generateUUID();
    const now = new Date().toISOString();

    const record: LaunchTokenRecord = {
      launchToken,
      hmsClientId,
      patientContext,
      userContext,
      scopes: requestedScopes,
      redirectUri,
      createdAt: now,
      ttl: futureEpoch(LAUNCH_TOKEN_TTL_SECONDS),
      used: false,
    };

    await putItem(Tables.LAUNCH_TOKENS, record);

    // ── Step 7: Build launch URL ───────────────────────────────────────────────
    // MyVitalRx will receive this URL and extract the launch_token parameter
    const launchUrl = `${MYVITALRX_BASE_URL}/launch?launch_token=${launchToken}`;

    const response: GenerateLaunchTokenResponse = {
      launchToken,
      launchUrl,
      expiresIn: LAUNCH_TOKEN_TTL_SECONDS,
      issuedAt: now,
    };

    logger.info("Launch token generated", {
      hmsClientId,
      patientId: patientContext.patientId,
      userId: userContext.userId,
      scopes: requestedScopes,
      expiresIn: LAUNCH_TOKEN_TTL_SECONDS,
    });

    return successResponse(response, 201);
  } catch (error) {
    logger.error("Unexpected error in GenerateLaunchToken", error);
    return Responses.internalError(context.awsRequestId);
  }
};
