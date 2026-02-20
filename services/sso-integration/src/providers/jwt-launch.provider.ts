/**
 * JWT Launch Provider
 * 
 * Verifies launch tokens using local JWT verification with shared launch_secret.
 * This is the current implementation - HMS signs a JWT with launch_secret, we verify it locally.
 */

import * as jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { LaunchTokenPayload } from '../types';
import { IHMSLaunchProvider } from './hms-launch.provider';
import { HMSClientService } from '../services/hms-client.service';

const LAUNCH_TOKEN_MAX_AGE = 5 * 60; // 5 minutes

/**
 * JWT-based launch provider (current implementation)
 * Verifies tokens locally using shared launch_secret from DynamoDB
 */
export class JWTLaunchProvider implements IHMSLaunchProvider {
  private hmsClientService: HMSClientService;

  constructor(hmsClientService: HMSClientService) {
    this.hmsClientService = hmsClientService;
  }

  getProviderType(): string {
    return 'jwt-local';
  }

  async verifyLaunchToken(launchToken: string, clientId: string): Promise<LaunchTokenPayload | null> {
    try {
      // Decode without verify first to get clientId for secret lookup
      const decoded = jwt.decode(launchToken) as Record<string, unknown> | null;
      if (!decoded) {
        logger.warn('Launch token invalid or malformed');
        return null;
      }

      // Use provided clientId or extract from token
      const tokenClientId =
        clientId ||
        (decoded.clientId as string) ||
        (decoded.client_id as string) ||
        (decoded.aud as string);
      
      if (!tokenClientId) {
        logger.warn('Launch token missing clientId (expected clientId, client_id, or aud)', {
          payloadKeys: Object.keys(decoded),
        });
        return null;
      }

      const hmsClient = await this.hmsClientService.getClient(tokenClientId);
      if (!hmsClient || !hmsClient.active) {
        logger.warn('HMS client not found or inactive', { clientId: tokenClientId });
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
        clientId: tokenClientId,
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
}
