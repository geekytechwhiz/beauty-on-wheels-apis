/**
 * TokenService
 * ────────────
 * Handles JWT verification for Cognito-issued tokens using the
 * `aws-jwt-verify` library, which fetches and caches the Cognito
 * JWKS (JSON Web Key Set) automatically.
 *
 * Why aws-jwt-verify?
 *   • Maintained by the AWS SDK team
 *   • Performs online JWKS caching (no need to maintain a JWKS URL manually)
 *   • Validates signature, expiry, issuer, audience, and token_use claim
 */

import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { CognitoConfig, CognitoJwtPayload, UserProfile } from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("TokenService");

// ─── Verifier instances (created once, reused across warm Lambda invocations) ─
let _accessVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;
let _idVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getAccessVerifier(config: CognitoConfig) {
  if (!_accessVerifier) {
    _accessVerifier = CognitoJwtVerifier.create({
      userPoolId: config.userPoolId,
      tokenUse: "access",
      clientId: config.clientId,
    });
  }
  return _accessVerifier;
}

function getIdVerifier(config: CognitoConfig) {
  if (!_idVerifier) {
    _idVerifier = CognitoJwtVerifier.create({
      userPoolId: config.userPoolId,
      tokenUse: "id",
      clientId: config.clientId,
    });
  }
  return _idVerifier;
}

// ─── Verify an access token ────────────────────────────────────────────────────
export async function verifyAccessToken(
  token: string,
  config: CognitoConfig
): Promise<CognitoJwtPayload> {
  logger.info("Verifying Cognito access token");

  try {
    const payload = await getAccessVerifier(config).verify(token);
    logger.info("Access token verified", { sub: payload.sub });
    return payload as unknown as CognitoJwtPayload;
  } catch (err) {
    logger.error("Access token verification failed", err);
    throw new Error("Invalid or expired access token");
  }
}

// ─── Verify an ID token ───────────────────────────────────────────────────────
export async function verifyIdToken(
  token: string,
  config: CognitoConfig
): Promise<CognitoJwtPayload> {
  logger.info("Verifying Cognito ID token");

  try {
    const payload = await getIdVerifier(config).verify(token);
    logger.info("ID token verified", { sub: payload.sub });
    return payload as unknown as CognitoJwtPayload;
  } catch (err) {
    logger.error("ID token verification failed", err);
    throw new Error("Invalid or expired ID token");
  }
}

// ─── Decode a JWT without verifying (for non-sensitive inspection) ────────────
export function decodeTokenPayload(token: string): CognitoJwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("Malformed JWT — expected 3 dot-separated segments");
  }

  // Add base64 padding if needed
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf-8");

  return JSON.parse(json) as CognitoJwtPayload;
}

// ─── Extract UserProfile from a verified JWT payload ──────────────────────────
export function payloadToUserProfile(payload: CognitoJwtPayload): UserProfile {
  return {
    userId: payload.sub,
    email: payload.email ?? "",
    emailVerified: payload.email_verified ?? false,
    name: payload.name,
    givenName: payload.given_name,
    familyName: payload.family_name,
    username: payload["cognito:username"],
    groups: payload["cognito:groups"] ?? [],
  };
}

// ─── Extract the raw bearer token from an Authorization header ────────────────
export function extractBearerToken(authHeader: string | undefined | null): string {
  if (!authHeader) {
    throw new Error("Authorization header is missing");
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    throw new Error(
      "Authorization header must follow the format: Bearer <token>"
    );
  }

  return parts[1];
}
