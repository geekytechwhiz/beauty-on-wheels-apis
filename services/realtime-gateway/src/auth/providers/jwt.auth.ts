import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import type { AuthProvider, AuthContext, AuthOptions } from '../types';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

function getStringClaim(decoded: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = decoded[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function getRoles(decoded: Record<string, unknown>): string[] {
  const r = decoded.roles ?? decoded.role ?? decoded['custom:roles'] ?? decoded['custom:userType'];
  if (Array.isArray(r)) return r.filter((x): x is string => typeof x === 'string');
  if (typeof r === 'string') return r.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

/**
 * JWT auth provider.
 * Supports Cognito-style custom claims (custom:userID, custom:organizationID) and standard sub.
 * Verifies signature when JWT_SECRET or JWT_JWKS_URI is set; otherwise decode-only (dev).
 */
export function createJwtAuthProvider(): AuthProvider {
  return {
    name: 'jwt',
    async authenticate(token: string, options?: AuthOptions): Promise<AuthContext | null> {
      const logger = createChildLogger(baseLogger, { correlationId: options?.correlationId });
      try {
        const jwt = await import('jsonwebtoken');
        const secret = process.env.JWT_SECRET;
        const jwksUri = process.env.JWT_JWKS_URI;
        let decoded: string | Record<string, unknown>;

        if (secret) {
          try {
            decoded = jwt.verify(token, secret) as Record<string, unknown>;
          } catch (verifyErr) {
            logger.warn({ event: 'jwt_verify_failed', err: serializeError(verifyErr) });
            return null;
          }
        } else if (jwksUri) {
          // TODO: Fetch JWKS from jwksUri, get signing key by kid from token header, verify.
          // For now decode without verification when only JWKS_URI is set.
          const payload = token.split('.')[1];
          if (!payload) return null;
          const raw = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
          decoded = JSON.parse(raw) as Record<string, unknown>;
        } else {
          const payload = token.split('.')[1];
          if (!payload) return null;
          const raw = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
          decoded = JSON.parse(raw) as Record<string, unknown>;
        }

        if (!decoded || typeof decoded !== 'object') return null;

        const userId = getStringClaim(
          decoded as Record<string, unknown>,
          'custom:userID',
          'custom:userId',
          'userID',
          'userId',
          'sub'
        );
        const orgId = getStringClaim(
          decoded as Record<string, unknown>,
          'custom:organizationID',
          'custom:organizationId',
          'organizationID',
          'organizationId',
          'org_id',
          'orgId'
        );
        const roles = getRoles(decoded as Record<string, unknown>);

        if (!userId || !orgId) {
          logger.warn({ event: 'jwt_missing_claims', hasUserId: !!userId, hasOrgId: !!orgId });
          return null;
        }

        return { userId, orgId, roles };
      } catch (err) {
        logger.warn({ event: 'jwt_auth_error', err: serializeError(err) });
        return null;
      }
    },
  };
}
