/**
 * Callback Handler
 * ────────────────
 * GET /auth/callback?code=<authorization_code>&state=<state>
 *
 * This is the OAuth2 redirect URI. Cognito calls this endpoint after
 * the user has successfully authenticated in the Hosted UI.
 *
 * Steps:
 *   1. Extract the `code` query parameter from the request.
 *   2. Exchange the authorization code for ID, access, and refresh tokens
 *      via the Cognito /oauth2/token endpoint.
 *   3. Optionally decode the ID token to extract user claims.
 *   4. Return the tokens to the client (JSON response).
 *
 * In a production app you would typically:
 *   • Set the tokens as secure HttpOnly cookies instead of returning them in JSON.
 *   • Redirect the browser to the frontend application URL.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "../../types";
import { getCognitoConfig, exchangeCodeForTokens } from "../../services/cognitoService";
import { decodeTokenPayload, payloadToUserProfile } from "../../services/tokenService";
import { ok, badRequest, internalServerError } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("CallbackHandler");

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(event.requestContext?.requestId ?? "unknown");
  logger.info("OAuth2 callback handler invoked");

  try {
    // ── 1. Extract authorization code ─────────────────────────────────────────
    const code = event.queryStringParameters?.["code"];
    const errorParam = event.queryStringParameters?.["error"];
    const errorDescription = event.queryStringParameters?.["error_description"];

    // Cognito returns ?error=access_denied when the user cancels login
    if (errorParam) {
      logger.warn("Cognito returned an error on callback", {
        error: errorParam,
        description: errorDescription,
      });
      return badRequest(errorParam, errorDescription ?? "Authentication was denied");
    }

    if (!code) {
      logger.warn("No authorization code present in callback");
      return badRequest("MISSING_CODE", "Authorization code not found in query parameters");
    }

    // ── 2. Exchange code for tokens ───────────────────────────────────────────
    const config = getCognitoConfig();
    const tokens = await exchangeCodeForTokens(code, config);

    // ── 3. Decode the ID token to retrieve user claims (no network call) ──────
    let userProfile = null;
    try {
      const idPayload = decodeTokenPayload(tokens.idToken);
      userProfile = payloadToUserProfile(idPayload);
      logger.info("User authenticated via SSO", {
        userId: userProfile.userId,
        email: userProfile.email,
      });
    } catch (decodeErr) {
      // Non-fatal: still return the tokens even if decode fails
      logger.warn("Could not decode ID token payload", { error: decodeErr });
    }

    // ── 4. Return tokens and user profile ─────────────────────────────────────
    //
    // SECURITY NOTE: In production, set tokens as secure, HttpOnly, SameSite=Strict
    // cookies instead of returning them in the response body.
    //
    return ok(
      {
        tokens: {
          idToken: tokens.idToken,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          tokenType: tokens.tokenType,
        },
        user: userProfile,
      },
      "Authentication successful"
    );
  } catch (err) {
    logger.error("Callback handler failed", err);
    return internalServerError(
      err instanceof Error ? err.message : "Token exchange failed"
    );
  }
};
