/**
 * Token Service - JWT generation and validation for SSO sessions
 */

import * as jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { SessionTokenPayload, AuthorizedContext } from '../types';
import { getConfig } from '../config';

export class TokenService {
  private secret: string;
  private expiresIn: number;

  constructor() {
    const config = getConfig();
    this.secret = config.jwtSecret;
    this.expiresIn = config.sessionExpiry;
  }

  generateSessionToken(payload: Omit<SessionTokenPayload, 'iat' | 'exp' | 'jti'>): string {
    const now = Math.floor(Date.now() / 1000);
    const jti = require('crypto').randomBytes(16).toString('hex');
    const tokenPayload: SessionTokenPayload = {
      ...payload,
      iat: now,
      exp: now + this.expiresIn,
      jti,
    };
    return jwt.sign(tokenPayload, this.secret, { algorithm: 'HS256' });
  }

  validateSessionToken(token: string): SessionTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret) as SessionTokenPayload;
      return decoded;
    } catch (error) {
      logger.warn('Session token validation failed', { error: (error as Error).message });
      return null;
    }
  }

  extractContext(payload: SessionTokenPayload): AuthorizedContext {
    return {
      hmsId: payload.hmsId,
      clientId: payload.clientId,
      userId: payload.sub,
      scope: payload.scope || [],
      permissions: payload.scope || [],
    };
  }
}
