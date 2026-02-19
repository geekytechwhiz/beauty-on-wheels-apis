// ─────────────────────────────────────────────────────────────────────────────
// SSO FLOW UNIT TESTS
// Tests the core token utilities and JWT logic
// ─────────────────────────────────────────────────────────────────────────────

import {
  generateUUID,
  generateRefreshToken,
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  futureEpoch,
  isNotExpired,
  nowSeconds,
  timingSafeEqual,
} from "../utils/token";

import {
  signAccessToken,
  verifyAccessToken,
  extractBearerToken,
  hasScopes,
} from "../utils/jwt";

import { SessionRecord } from "../types";

// ── Set JWT_SECRET for tests ──────────────────────────────────────────────────
process.env["JWT_SECRET"] = "test-secret-key-that-is-long-enough-32+chars";
process.env["JWT_EXPIRY"] = "3600";

// ── Mock Session ──────────────────────────────────────────────────────────────
const mockSession: SessionRecord = {
  sessionId: "sess-001",
  refreshToken: "refresh-abc-123",
  hmsClientId: "HMS-ORG-001",
  patientContext: {
    patientId: "patient-001",
    mrn: "MRN-001",
    firstName: "John",
    lastName: "Doe",
  },
  userContext: {
    userId: "user-doc-001",
    username: "dr.mitchell",
    role: "physician",
  },
  scopes: ["read:patient", "read:health-records"],
  isRevoked: false,
  createdAt: new Date().toISOString(),
  lastUsedAt: new Date().toISOString(),
  ttl: futureEpoch(86400),
};

// ─────────────────────────────────────────────────────────────────────────────
// Token Utilities
// ─────────────────────────────────────────────────────────────────────────────

describe("Token Utilities", () => {
  test("generateUUID produces a valid UUID v4 format", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test("generateUUID produces unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, generateUUID));
    expect(ids.size).toBe(100);
  });

  test("generateRefreshToken returns a 64-char hex string", () => {
    const token = generateRefreshToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  test("API key hash/verify round-trip", () => {
    const clientId = "HMS-TEST-001";
    const apiKey = generateApiKey(clientId);
    expect(apiKey).toContain(`hms_${clientId}_`);

    const hash = hashApiKey(apiKey);
    expect(verifyApiKey(apiKey, hash)).toBe(true);
    expect(verifyApiKey("wrong-key", hash)).toBe(false);
  });

  test("timingSafeEqual returns correct results", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "xyz")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });

  test("futureEpoch returns a value greater than nowSeconds()", () => {
    const future = futureEpoch(300);
    expect(future).toBeGreaterThan(nowSeconds());
    expect(future).toBeCloseTo(nowSeconds() + 300, -1);
  });

  test("isNotExpired correctly identifies expired vs. valid TTLs", () => {
    expect(isNotExpired(futureEpoch(300))).toBe(true);
    expect(isNotExpired(nowSeconds() - 1)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JWT Utilities
// ─────────────────────────────────────────────────────────────────────────────

describe("JWT Utilities", () => {
  test("signAccessToken creates a valid JWT for a session", () => {
    const token = signAccessToken(mockSession);
    expect(typeof token).toBe("string");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  test("verifyAccessToken decodes a correctly signed token", () => {
    const token = signAccessToken(mockSession);
    const payload = verifyAccessToken(token);

    expect(payload.sub).toBe(mockSession.sessionId);
    expect(payload.hmsClientId).toBe(mockSession.hmsClientId);
    expect(payload.patientId).toBe(mockSession.patientContext.patientId);
    expect(payload.userId).toBe(mockSession.userContext.userId);
    expect(payload.role).toBe(mockSession.userContext.role);
    expect(payload.scopes).toEqual(mockSession.scopes);
    expect(payload.iss).toBe("myvitalrx-sso");
    expect(payload.aud).toBe("myvitalrx-api");
  });

  test("verifyAccessToken throws on tampered token", () => {
    const token = signAccessToken(mockSession);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  test("verifyAccessToken throws on wrong secret", () => {
    const originalSecret = process.env["JWT_SECRET"];
    process.env["JWT_SECRET"] = "different-secret-key-also-long-enough";
    const token = signAccessToken(mockSession);

    process.env["JWT_SECRET"] = originalSecret;
    expect(() => verifyAccessToken(token)).toThrow();
  });

  test("extractBearerToken parses Authorization header correctly", () => {
    expect(extractBearerToken("Bearer my-token-123")).toBe("my-token-123");
    expect(extractBearerToken("bearer MY-TOKEN")).toBe("MY-TOKEN");
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  test("hasScopes correctly validates scope requirements", () => {
    const payload = verifyAccessToken(signAccessToken(mockSession));

    expect(hasScopes(payload, ["read:patient"])).toBe(true);
    expect(hasScopes(payload, ["read:patient", "read:health-records"])).toBe(true);
    expect(hasScopes(payload, ["write:health-records"])).toBe(false);
    expect(hasScopes(payload, ["read:patient", "write:medications"])).toBe(false);
  });
});
