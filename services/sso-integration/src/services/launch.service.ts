/**
 * Launch Service - Verifies HMS launch tokens and creates JWT sessions
 * 
 * Flow:
 * 1. HMS redirects user to /sso/launch?launch_token=JWT&redirect_uri=...
 * 2. We verify launch_token (JWT signed by HMS with shared launch_secret)
 * 3. Create session JWT
 * 4. Redirect user to app with session
 */

import * as jwt from 'jsonwebtoken';
import { HMSClientService } from './hms-client.service';
import { TokenService } from './token.service';
import { logger } from '../utils/logger';
import { LaunchTokenPayload, SessionTokenPayload } from '../types';

const LAUNCH_TOKEN_MAX_AGE = 5 * 60; // 5 minutes

export class LaunchService {
  private hmsClientService: HMSClientService;
  private tokenService: TokenService;

  constructor() {
    this.hmsClientService = new HMSClientService();
    this.tokenService = new TokenService();
  }

  /**
   * Verify launch token from HMS
   * Token must be signed with launch_secret from registered HMS client
   */
  async verifyLaunchToken(launchToken: string): Promise<LaunchTokenPayload | null> {
    try {
      // Decode without verify first to get clientId for secret lookup
      const decoded = jwt.decode(launchToken) as Record<string, unknown> | null;
      if (!decoded) {
        logger.warn('Launch token invalid or malformed');
        return null;
      }

      // Support clientId, client_id, or aud (common JWT conventions)
      const clientId =
        (decoded.clientId as string) ||
        (decoded.client_id as string) ||
        (decoded.aud as string);
      if (!clientId) {
        logger.warn('Launch token missing clientId (expected clientId, client_id, or aud)', {
          payloadKeys: Object.keys(decoded),
        });
        return null;
      }

      const hmsClient = await this.hmsClientService.getClient(clientId);
      if (!hmsClient || !hmsClient.active) {
        logger.warn('HMS client not found or inactive', { clientId: decoded.clientId });
        return null;
      }

      const verified = jwt.verify(launchToken, hmsClient.launchSecret, {
        algorithms: ['HS256'],
        maxAge: LAUNCH_TOKEN_MAX_AGE,
      }) as Record<string, unknown>;

      // Normalize to LaunchTokenPayload
      return {
        sub: verified.sub as string,
        hmsId: (verified.hmsId || verified.hms_id) as string,
        clientId,
        email: verified.email as string | undefined,
        name: verified.name as string | undefined,
        roles: verified.roles as string[] | undefined,
        permissions: verified.permissions as string[] | undefined,
        iat: verified.iat as number,
        exp: verified.exp as number,
      };
    } catch (error) {
      logger.warn('Launch token verification failed', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Create JWT session from verified launch token payload
   */
  createSession(launchPayload: LaunchTokenPayload): string {
    const sessionId = require('crypto').randomBytes(16).toString('hex');
    const scope = launchPayload.permissions || launchPayload.roles || ['user:read'];

    const payload: Omit<SessionTokenPayload, 'iat' | 'exp' | 'jti'> = {
      sub: launchPayload.sub,
      hmsId: launchPayload.hmsId,
      clientId: launchPayload.clientId,
      sessionId,
      email: launchPayload.email,
      name: launchPayload.name,
      scope,
      iss: process.env.APP_ISSUER || 'myvitalrx-sso',
      aud: 'myvitalrx-app',
    };

    const sessionToken = this.tokenService.generateSessionToken(payload);
    logger.info('Session created', {
      userId: launchPayload.sub,
      hmsId: launchPayload.hmsId,
      clientId: launchPayload.clientId,
    });

    return sessionToken;
  }

  /**
   * Full launch flow: verify token + create session
   */
  async processLaunch(launchToken: string): Promise<{ sessionToken: string; userId: string; hmsId: string } | null> {
    const payload = await this.verifyLaunchToken(launchToken);
    if (!payload) return null;

    const sessionToken = this.createSession(payload);
    return {
      sessionToken,
      userId: payload.sub,
      hmsId: payload.hmsId,
    };
  }
}
