import * as jwt from 'jsonwebtoken';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { getEnvConfig } from '../config/env';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

const SERVICE_TOKEN_ISSUER = 'firminiq-integration';
const SERVICE_TOKEN_AUDIENCE = 'myvitalrx-api';
const SERVICE_TOKEN_SUBJECT = 'integration-hms';
const SERVICE_TOKEN_EXPIRY_SECONDS = 60 * 60; // 1 hour

export type ServiceUserRole = 'PATIENT' | 'DOCTOR';

export interface ServiceTokenContext {
  userId: string;
  role: ServiceUserRole;
  appointmentId?: string | number;
}

export interface ServiceTokenResult {
  token: string;
  expiresIn: number;
  userId: string;
  role: ServiceUserRole;
}

/**
 * Service responsible for issuing and verifying internal service-level JWTs.
 *
 * These tokens:
 * - Are issued after HMS SSO launch (doctor/patient verified or created).
 * - Carry minimal user context needed by downstream APIs.
 * - Are signed with SERVICE_TOKEN_SECRET using HS256 (symmetric key).
 * - Are completely separate from Cognito access/ID tokens.
 */
export class ServiceTokenService {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'ServiceTokenService',
  });
  private readonly secret: string;

  constructor() {
    const env = getEnvConfig();
    this.secret = env.SERVICE_TOKEN_SECRET;

    if (!this.secret) {
      this.logger.warn({
        event: 'service_token_secret_missing',
        message:
          'SERVICE_TOKEN_SECRET is not configured. Service tokens cannot be generated or verified.',
      });
    }
  }

  /**
   * Generates a signed service-level JWT containing the provided user context.
   *
   * Payload shape:
   * {
   *   iss: "firminiq-integration",
   *   aud: "myvitalrx-api",
   *   sub: "integration-hms",
   *   tenantId: "<organizationId>",
   *   context: { userId, role, appointmentId? },
   *   iat,
   *   exp
   * }
   */
  generateToken(
    tenantId: string,
    context: ServiceTokenContext,
    correlationId?: string,
  ): ServiceTokenResult {
    const logger = createChildLogger(this.logger, { correlationId, tenantId, userId: context.userId });

    if (!this.secret) {
      const error = new Error('SERVICE_TOKEN_SECRET is not configured');
      logger.error({
        event: 'service_token_generate_missing_secret',
        err: serializeError(error),
      });
      throw error;
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + SERVICE_TOKEN_EXPIRY_SECONDS;

    const payload = {
      iss: SERVICE_TOKEN_ISSUER,
      aud: SERVICE_TOKEN_AUDIENCE,
      sub: SERVICE_TOKEN_SUBJECT,
      tenantId,
      context: {
        userId: context.userId,
        role: context.role,
        ...(context.appointmentId != null && { appointmentId: context.appointmentId }),
      },
      iat: now,
      exp,
    };

    const token = jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
    });

    logger.info({
      event: 'service_token_generated',
      role: context.role,
      expiresIn: SERVICE_TOKEN_EXPIRY_SECONDS,
    });

    return {
      token,
      expiresIn: SERVICE_TOKEN_EXPIRY_SECONDS,
      userId: context.userId,
      role: context.role,
    };
  }

  /**
   * Verifies a service token and returns the decoded payload.
   * Intended for use by downstream APIs or middleware.
   */
  verifyToken(token: string): any {
    if (!this.secret) {
      throw new Error('SERVICE_TOKEN_SECRET is not configured');
    }

    return jwt.verify(token, this.secret, {
      algorithms: ['HS256'],
      issuer: SERVICE_TOKEN_ISSUER,
      audience: SERVICE_TOKEN_AUDIENCE,
    });
  }
}

let serviceTokenServiceInstance: ServiceTokenService | null = null;

export function getServiceTokenService(): ServiceTokenService {
  if (!serviceTokenServiceInstance) {
    serviceTokenServiceInstance = new ServiceTokenService();
  }
  return serviceTokenServiceInstance;
}

