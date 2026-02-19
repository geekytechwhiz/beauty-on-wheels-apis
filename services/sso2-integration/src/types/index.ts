// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES — HMS ↔ MyVitalRx SSO System
// ─────────────────────────────────────────────────────────────────────────────

// ── DynamoDB Record Shapes ────────────────────────────────────────────────────

/**
 * Stored in LaunchTokensTable.
 * Created by HMS, consumed (once) by MyVitalRx.
 */
export interface LaunchTokenRecord {
  launchToken: string;       // PK — UUID v4 one-time token
  hmsClientId: string;       // Which HMS org created this token
  patientContext: PatientContext;
  userContext: UserContext;
  scopes: string[];          // Requested API scopes e.g. ["read:patient","read:records"]
  redirectUri: string;       // Where MyVitalRx should redirect after auth
  createdAt: string;         // ISO timestamp
  ttl: number;               // Unix epoch — DynamoDB TTL (5 min)
  used: boolean;             // Prevent replay attacks
}

/**
 * Stored in SessionsTable.
 * Created by MyVitalRx after validating the launch token.
 */
export interface SessionRecord {
  sessionId: string;         // PK — UUID v4
  refreshToken: string;      // GSI — Opaque refresh token
  hmsClientId: string;
  patientContext: PatientContext;
  userContext: UserContext;
  scopes: string[];
  isRevoked: boolean;
  createdAt: string;
  lastUsedAt: string;
  ttl: number;               // Unix epoch — DynamoDB TTL (24h)
}

/**
 * Stored in HmsClientsTable.
 * Registered HMS organisations that are allowed to use SSO.
 */
export interface HmsClientRecord {
  clientId: string;          // PK — e.g. "HMS-ORG-001"
  clientName: string;        // e.g. "City General Hospital"
  apiKeyHash: string;        // bcrypt/SHA-256 hash of the API key
  allowedScopes: string[];   // Scopes this client is permitted to request
  allowedRedirectUris: string[]; // Whitelist of valid redirect URIs
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Context Shapes ────────────────────────────────────────────────────────────

export interface PatientContext {
  patientId: string;         // MyVitalRx / HMS patient identifier
  mrn?: string;              // Medical Record Number (HMS side)
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;      // ISO date string
}

export interface UserContext {
  userId: string;            // HMS user who initiated the SSO
  username: string;
  role: HmsUserRole;
  email?: string;
}

export type HmsUserRole = "physician" | "nurse" | "admin" | "pharmacist" | "lab_technician";

// ── JWT Payload ───────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;               // subject = sessionId
  iss: string;               // issuer  = "myvitalrx-sso"
  aud: string;               // audience = "myvitalrx-api"
  iat: number;               // issued at
  exp: number;               // expiry
  jti: string;               // JWT ID (unique per token)
  hmsClientId: string;
  patientId: string;
  userId: string;
  role: HmsUserRole;
  scopes: string[];
}

// ── API Request / Response Shapes ─────────────────────────────────────────────

/** POST /hms/launch — request body */
export interface GenerateLaunchTokenRequest {
  patientContext: PatientContext;
  userContext: UserContext;
  scopes?: string[];         // Optional — defaults to HMS client's allowed scopes
  redirectUri: string;       // Where MyVitalRx redirects after successful auth
}

/** POST /hms/launch — success response */
export interface GenerateLaunchTokenResponse {
  launchToken: string;
  launchUrl: string;         // Full redirect URL: redirectUri?launch_token=<token>
  expiresIn: number;         // Seconds until launch token expires
  issuedAt: string;
}

/** POST /auth/exchange — request body */
export interface ExchangeLaunchTokenRequest {
  launchToken: string;
}

/** POST /auth/exchange — success response */
export interface ExchangeLaunchTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;         // Seconds
  scopes: string[];
  patientContext: PatientContext;
  userContext: UserContext;
}

/** POST /auth/refresh — request body */
export interface RefreshTokenRequest {
  refreshToken: string;
}

/** POST /auth/refresh — success response */
export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;      // Rotated refresh token
  tokenType: "Bearer";
  expiresIn: number;
}

/** POST /auth/revoke — request body */
export interface RevokeTokenRequest {
  sessionId?: string;        // Revoke specific session
  all?: boolean;             // Revoke all sessions for this user
}

/** POST /admin/hms-clients — request body */
export interface RegisterHmsClientRequest {
  clientId: string;
  clientName: string;
  allowedScopes: string[];
  allowedRedirectUris: string[];
}

/** POST /admin/hms-clients — success response */
export interface RegisterHmsClientResponse {
  clientId: string;
  clientName: string;
  apiKey: string;            // Plain text — shown ONCE, then only hash is stored
  allowedScopes: string[];
}

// ── Standard API Error Response ───────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;             // Machine-readable error code
  message: string;           // Human-readable message
  requestId?: string;
  timestamp: string;
}

// ── Lambda Authorizer Context ─────────────────────────────────────────────────

export interface AuthorizerContext {
  sessionId: string;
  hmsClientId: string;
  patientId: string;
  userId: string;
  role: string;
  scopes: string;            // Comma-separated (API GW context is string only)
}

// ── Available Scopes ──────────────────────────────────────────────────────────

export const AVAILABLE_SCOPES = {
  READ_PATIENT: "read:patient",
  READ_HEALTH_RECORDS: "read:health-records",
  WRITE_HEALTH_RECORDS: "write:health-records",
  READ_MEDICATIONS: "read:medications",
  WRITE_MEDICATIONS: "write:medications",
  READ_LAB_RESULTS: "read:lab-results",
} as const;

export type Scope = (typeof AVAILABLE_SCOPES)[keyof typeof AVAILABLE_SCOPES];
