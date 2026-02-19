// ─────────────────────────────────────────────────────────────────────────────
// TOKEN UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";

/**
 * Generate a cryptographically secure UUID v4.
 * Used for: sessionId, launchToken, jti
 */
export function generateUUID(): string {
  return uuidv4();
}

/**
 * Generate an opaque refresh token (256-bit random hex string).
 * Stored in DynamoDB as-is; treated as a long-lived secret.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Generate a secure API key for HMS clients.
 * Format: hms_<clientId>_<64-char-hex>
 */
export function generateApiKey(clientId: string): string {
  const secret = randomBytes(32).toString("hex");
  return `hms_${clientId}_${secret}`;
}

/**
 * Hash an API key (SHA-256) before storing in DynamoDB.
 * Never store plain-text API keys.
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Verify an incoming API key against a stored hash.
 */
export function verifyApiKey(plainKey: string, storedHash: string): boolean {
  const computedHash = hashApiKey(plainKey);
  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(computedHash, storedHash);
}

/**
 * Constant-time string comparison.
 * Prevents timing-based side-channel attacks when comparing secrets.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Get the current Unix epoch timestamp in seconds.
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Convert a seconds-duration to a future Unix epoch timestamp.
 */
export function futureEpoch(durationSeconds: number): number {
  return nowSeconds() + durationSeconds;
}

/**
 * Check if a DynamoDB TTL value is still valid (not expired).
 */
export function isNotExpired(ttlSeconds: number): boolean {
  return ttlSeconds > nowSeconds();
}
