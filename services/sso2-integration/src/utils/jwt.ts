// ─────────────────────────────────────────────────────────────────────────────
// JWT UTILITIES — Sign, Verify, Decode
// ─────────────────────────────────────────────────────────────────────────────

import jwt from "jsonwebtoken";
import { JwtPayload, SessionRecord } from "../types";
import { generateUUID, nowSeconds } from "./token";

const JWT_ISSUER = "myvitalrx-sso";
const JWT_AUDIENCE = "myvitalrx-api";

/** Read JWT secret from environment (set via SSM Parameter Store in SAM) */
function getSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

/** JWT expiry in seconds (default: 3600 = 1 hour) */
function getExpiry(): number {
  return parseInt(process.env["JWT_EXPIRY"] ?? "3600", 10);
}

// ── Sign ──────────────────────────────────────────────────────────────────────

/**
 * Create a signed JWT (access token) from a session record.
 */
export function signAccessToken(session: SessionRecord): string {
  const expiresIn = getExpiry();
  const now = nowSeconds();

  const payload: Omit<JwtPayload, "iat" | "exp"> = {
    sub: session.sessionId,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    jti: generateUUID(),        // Unique JWT ID — prevents replay
    hmsClientId: session.hmsClientId,
    patientId: session.patientContext.patientId,
    userId: session.userContext.userId,
    role: session.userContext.role,
    scopes: session.scopes,
  };

  return jwt.sign(payload, getSecret(), {
    expiresIn,
    algorithm: "HS256",
  });
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verify and decode a JWT access token.
 * Throws if the token is invalid, expired, or tampered.
 */
export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getSecret(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: ["HS256"],
  });

  return decoded as JwtPayload;
}

// ── Decode (no verification) ──────────────────────────────────────────────────

/**
 * Decode without verifying — use ONLY for logging/debugging.
 * NEVER use this for authentication decisions.
 */
export function decodeTokenUnsafe(token: string): JwtPayload | null {
  return jwt.decode(token) as JwtPayload | null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Strip "Bearer " prefix from Authorization header.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") return null;
  return parts[1] ?? null;
}

/**
 * Check if a decoded payload has all required scopes.
 */
export function hasScopes(payload: JwtPayload, requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => payload.scopes.includes(scope));
}
