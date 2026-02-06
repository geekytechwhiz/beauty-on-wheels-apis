import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import type { AuthProvider, AuthContext, AuthOptions } from '../types';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

/**
 * OAuth token introspection response (RFC 7662).
 */
interface IntrospectionResponse {
  active?: boolean;
  sub?: string;
  user_id?: string;
  organization_id?: string;
  org_id?: string;
  roles?: string[];
  role?: string;
  [key: string]: unknown;
}

/**
 * OAuth auth provider.
 * Calls token introspection endpoint (RFC 7662) and maps response to AuthContext.
 * Requires INTROSPECTION_URL; optional INTROSPECTION_CLIENT_ID + INTROSPECTION_CLIENT_SECRET for basic auth.
 */
export function createOAuthAuthProvider(): AuthProvider {
  return {
    name: 'oauth',
    async authenticate(token: string, options?: AuthOptions): Promise<AuthContext | null> {
      const logger = createChildLogger(baseLogger, { correlationId: options?.correlationId });
      const url = process.env.INTROSPECTION_URL;
      if (!url) {
        logger.warn({ event: 'oauth_introspection_skipped', reason: 'INTROSPECTION_URL not set' });
        return null;
      }

      try {
        const clientId = process.env.INTROSPECTION_CLIENT_ID;
        const clientSecret = process.env.INTROSPECTION_CLIENT_SECRET;
        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (clientId && clientSecret) {
          headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        }
        const body = new URLSearchParams({ token }).toString();
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
        });
        if (!res.ok) {
          logger.warn({ event: 'oauth_introspection_error', status: res.status });
          return null;
        }
        const data = (await res.json()) as IntrospectionResponse;
        if (!data.active) {
          logger.warn({ event: 'oauth_token_inactive' });
          return null;
        }
        const userId = typeof data.sub === 'string' ? data.sub : data.user_id ?? undefined;
        const orgId = data.organization_id ?? data.org_id ?? undefined;
        let roles: string[] = [];
        if (Array.isArray(data.roles)) roles = data.roles.filter((r): r is string => typeof r === 'string');
        else if (typeof data.role === 'string') roles = [data.role];
        if (!userId || !orgId) {
          logger.warn({ event: 'oauth_missing_claims', hasUserId: !!userId, hasOrgId: !!orgId });
          return null;
        }
        return { userId, orgId, roles };
      } catch (err) {
        logger.warn({ event: 'oauth_auth_error', err: serializeError(err) });
        return null;
      }
    },
  };
}
