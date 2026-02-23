/**
 * Login Handler
 * ─────────────
 * GET /auth/login
 *
 * Redirects the browser to the Cognito Hosted UI login page.
 * Cognito handles the actual authentication (username/password,
 * social providers, SAML, etc.) and then redirects back to the
 * CALLBACK_URL with an authorization code.
 *
 * Flow:
 *   Browser → GET /auth/login
 *           ← 302 Redirect → Cognito Hosted UI
 *                          ← 302 Redirect → /auth/callback?code=xxx
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "../../types";
import { getCognitoConfig, buildLoginUrl } from "../../services/cognitoService";
import { redirect, internalServerError } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("LoginHandler");

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(event.requestContext?.requestId ?? "unknown");
  logger.info("Login handler invoked — redirecting to Cognito Hosted UI");

  try {
    const config = getCognitoConfig();
    const loginUrl = buildLoginUrl(config);

    logger.info("Redirecting to Cognito Hosted UI", {
      domain: config.domain,
      callbackUrl: config.callbackUrl,
    });

    return redirect(loginUrl);
  } catch (err) {
    logger.error("Login handler failed", err);
    return internalServerError(
      err instanceof Error ? err.message : "Failed to initiate login"
    );
  }
};
