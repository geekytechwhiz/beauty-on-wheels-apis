import * as jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

const SERVICE_TOKEN_ISSUER = 'firminiq-integration';
const SERVICE_TOKEN_AUDIENCE = 'myvitalrx-api';

interface ServiceTokenPayload {
  iss: string;
  aud: string;
  sub: string;
  tenantId: string;
  context: {
    userId: string;
    role: 'PATIENT' | 'DOCTOR';
    appointmentId?: string | number;
  };
  iat: number;
  exp: number;
}

/**
 * Example Express-style middleware for verifying service tokens issued by the
 * SSO integration service.
 *
 * Usage (downstream API):
 *
 *   app.use(verifyServiceToken());
 *
 * On success, attaches the decoded user context to `req.user` and the
 * tenant/organization id to `req.tenantId`.
 */
export function verifyServiceToken() {
  const secret = process.env.SERVICE_TOKEN_SECRET;

  if (!secret) {
    throw new Error('SERVICE_TOKEN_SECRET is not configured');
  }

  return (req: Request & { user?: unknown; tenantId?: string }, res: Response, next: NextFunction) => {
    const logger = createChildLogger(baseLogger, { path: req.path });

    const authHeader =
      (req.headers.authorization as string | undefined) ||
      (req.headers.Authorization as unknown as string | undefined);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn({
        event: 'service_token_missing',
      });
      return res.status(401).json({ message: 'Missing Authorization header' });
    }

    const token = authHeader.substring('Bearer '.length).trim();

    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: SERVICE_TOKEN_ISSUER,
        audience: SERVICE_TOKEN_AUDIENCE,
      }) as ServiceTokenPayload;

      req.user = decoded.context;
      req.tenantId = decoded.tenantId;

      logger.debug({
        event: 'service_token_verified',
        role: decoded.context.role,
      });

      return next();
    } catch (error) {
      logger.warn({
        event: 'service_token_invalid',
        err: serializeError(error as Error),
      });
      return res.status(401).json({ message: 'Invalid or expired service token' });
    }
  };
}

