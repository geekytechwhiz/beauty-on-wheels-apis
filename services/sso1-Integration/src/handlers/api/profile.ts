/**
 * Profile Handler (Protected Endpoint)
 * ──────────────────────────────────────
 * GET /api/profile
 * Authorization: Bearer <access_token>
 *
 * This endpoint is PROTECTED by the Cognito User Pool Authorizer configured
 * in serverless.yml. API Gateway validates the JWT before this Lambda runs,
 * so by the time this handler executes, the request is already authenticated.
 *
 * The verified user claims are available in:
 *   event.requestContext.authorizer.claims  ← built-in Cognito authorizer
 *
 * What this handler does:
 *   1. Reads the Cognito claims injected by API Gateway.
 *   2. Optionally fetches additional user attributes from the User Pool.
 *   3. Returns a normalised UserProfile to the client.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult, UserProfile } from "../../types";
import { getCognitoConfig, getUserBySdkToken } from "../../services/cognitoService";
import {
  extractBearerToken,
  decodeTokenPayload,
  payloadToUserProfile,
} from "../../services/tokenService";
import { ok, unauthorized, internalServerError } from "../../utils/response";
import { createLogger } from "../../utils/logger";

const logger = createLogger("ProfileHandler");

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(event.requestContext?.requestId ?? "unknown");
  logger.info("Profile handler invoked");

  try {
    // ── 1. Read claims injected by the Cognito User Pool Authorizer ───────────
    //   API Gateway validates the JWT and populates requestContext.authorizer.claims
    //   with the token payload when using a COGNITO_USER_POOLS authorizer.
    const claims = event.requestContext?.authorizer?.["claims"] as
      | Record<string, string>
      | undefined;

    let profile: UserProfile;

    if (claims && claims["sub"]) {
      // Fast path — claims are already available from the authorizer
      logger.info("Building profile from authorizer claims", { sub: claims["sub"] });

      profile = {
        userId: claims["sub"],
        email: claims["email"] ?? "",
        emailVerified: claims["email_verified"] === "true",
        name: claims["name"],
        givenName: claims["given_name"],
        familyName: claims["family_name"],
        username: claims["cognito:username"],
        groups: claims["cognito:groups"]
          ? claims["cognito:groups"].split(",")
          : [],
      };
    } else {
      // Fallback — decode the raw access token from the Authorization header
      logger.info("No claims in authorizer context — decoding token directly");

      const authHeader = event.headers?.["Authorization"] ?? event.headers?.["authorization"];

      let token: string;
      try {
        token = extractBearerToken(authHeader);
      } catch {
        return unauthorized("Authorization header missing or malformed");
      }

      try {
        // Use the Cognito SDK to fetch up-to-date user attributes
        const config = getCognitoConfig();
        profile = await getUserBySdkToken(token, config);
      } catch {
        // Last resort: decode the token without a network call
        try {
          const payload = decodeTokenPayload(token);
          profile = payloadToUserProfile(payload);
        } catch {
          return unauthorized("Token could not be decoded");
        }
      }
    }

    logger.info("Profile fetched successfully", { userId: profile.userId });

    return ok<UserProfile>(profile, "User profile retrieved successfully");
  } catch (err) {
    logger.error("Profile handler failed", err);
    return internalServerError(
      err instanceof Error ? err.message : "Failed to retrieve user profile"
    );
  }
};
