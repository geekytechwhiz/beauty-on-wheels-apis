/**
 * Result of successful authentication.
 * Used to build connection metadata (not domain data).
 */
export interface AuthContext {
  userId: string;
  orgId: string;
  roles: string[];
}

/**
 * Options passed to auth providers (e.g. for introspection client credentials).
 */
export interface AuthOptions {
  /** Optional correlation id for logging */
  correlationId?: string;
  /** Extra provider-specific options */
  [key: string]: unknown;
}

/**
 * Auth provider contract.
 * Implementations: JWT (Cognito/generic), OAuth (introspection), API key, etc.
 */
export interface AuthProvider {
  readonly name: string;
  authenticate(token: string, options?: AuthOptions): Promise<AuthContext | null>;
}
