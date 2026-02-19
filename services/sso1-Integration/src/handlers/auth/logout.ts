/**
 * Logout Handler
 * ──────────────
 * GET /auth/logout?username=<cognito_username>
 *
 * Performs a complete sign-out:
 *   1. Calls Cognito AdminUserGlobalSignOut to revoke ALL tokens for the user
 *      (refresh tokens, access tokens) across all sessions/devices.
 *   2. Redirects the browser to the Cognito Hosted UI logout endpoint,
 *      which clears the Cognito session cookie.
 *   3. After Cognito clears its session, the user is redirected to the
 *      configured LOGOUT_REDIRECT_URL (e.g. your app's home page).
 *
 * Notes:
 *   • The `username` query parameter is required for the SDK global sign-out.
 *   • In a cookie-based app, you would clear the token cookies here as well.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "../../types";
import {
  getCognitoConfig,
  globalSignOut,
  buildLogoutUrl,
} from "../../services/cognitoService";
import { redirect, badRequest, internalServerError } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("LogoutHandler");

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(event.requestContext?.requestId ?? "unknown");
  logger.info("Logout handler invoked");

  try {
    const config = getCognitoConfig();

    // ── 1. Global sign-out via SDK (requires a Cognito username) ──────────────
    const username = event.queryStringParameters?.["username"];

    if (username) {
      try {
        await globalSignOut(username, config);
        logger.info("Global sign-out completed", { username });
      } catch (signOutErr) {
        // Log but do not fail — always redirect to clear the Hosted UI session
        logger.warn("Global sign-out SDK call failed (continuing with redirect)", {
          username,
          error: signOutErr instanceof Error ? signOutErr.message : String(signOutErr),
        });
      }
    } else {
      logger.warn(
        "No username provided — skipping AdminUserGlobalSignOut. " +
          "Pass ?username=<cognito_username> to revoke all tokens."
      );
    }

    // ── 2. Redirect to Cognito Hosted UI logout to clear the SSO session ──────
    const cognitoLogoutUrl = buildLogoutUrl(config);
    logger.info("Redirecting to Cognito logout endpoint", {
      logoutRedirectUrl: config.logoutRedirectUrl,
    });

    return redirect(cognitoLogoutUrl);
  } catch (err) {
    logger.error("Logout handler failed", err);

    if (err instanceof Error && err.message.includes("Missing required")) {
      return badRequest("CONFIG_ERROR", err.message);
    }

    return internalServerError(
      err instanceof Error ? err.message : "Logout failed"
    );
  }
};
