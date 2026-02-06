import type { AuthProvider } from './types';
import { createJwtAuthProvider } from './providers/jwt.auth';
import { createOAuthAuthProvider } from './providers/oauth.auth';

const providers: Map<string, AuthProvider> = new Map([
  ['jwt', createJwtAuthProvider()],
  ['oauth', createOAuthAuthProvider()],
]);

/**
 * Resolve auth provider by type (e.g. from query param authType).
 * Built-in: jwt, oauth. Use registerAuthProvider to add more (e.g. api_key, saml).
 * Defaults to jwt when authType is missing or unknown.
 */
export function getAuthProvider(authType?: string | null): AuthProvider {
  const key = (authType ?? 'jwt').toLowerCase();
  return providers.get(key) ?? providers.get('jwt')!;
}

/** Register an additional auth provider for a given type name. */
export function registerAuthProvider(type: string, provider: AuthProvider): void {
  providers.set(type.toLowerCase(), provider);
}
