/**
 * HMS Remote Verify Provider (Example Implementation)
 * 
 * This is a skeleton for future implementation that calls HMS /verify endpoint.
 * Currently not implemented - shows how to add a new provider type.
 * 
 * To use this:
 * 1. Implement the HTTP call to HMS /verify endpoint
 * 2. Map HMS response to LaunchTokenPayload
 * 3. Register this provider in LaunchService based on client config
 */

import { logger } from '../utils/logger';
import { LaunchTokenPayload } from '../types';
import { IHMSLaunchProvider } from './hms-launch.provider';
import { HMSClientService } from '../services/hms-client.service';

/**
 * Remote HMS verify provider (skeleton - not fully implemented)
 * Calls HMS /verify endpoint to verify launch tokens
 */
export class HMSVerifyProvider implements IHMSLaunchProvider {
  private hmsClientService: HMSClientService;
  private verifyTimeout: number;

  constructor(hmsClientService: HMSClientService, verifyTimeout = 5000) {
    this.hmsClientService = hmsClientService;
    this.verifyTimeout = verifyTimeout;
  }

  getProviderType(): string {
    return 'hms-verify-remote';
  }

  async verifyLaunchToken(launchToken: string, clientId: string): Promise<LaunchTokenPayload | null> {
    try {
      const hmsClient = await this.hmsClientService.getClient(clientId);
      if (!hmsClient || !hmsClient.active) {
        logger.warn('HMS client not found or inactive', { clientId });
        return null;
      }

      // TODO: Get HMS verify endpoint URL from client config or env
      // const verifyUrl = hmsClient.verifyEndpoint || process.env.HMS_VERIFY_ENDPOINT;
      // if (!verifyUrl) {
      //   logger.error('HMS verify endpoint not configured', { clientId });
      //   return null;
      // }

      // TODO: Make HTTP request to HMS /verify endpoint
      // Example:
      // const response = await fetch(verifyUrl, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Authorization': `Bearer ${hmsClient.clientSecret}`, // or API key
      //   },
      //   body: JSON.stringify({ launch_token: launchToken }),
      //   signal: AbortSignal.timeout(this.verifyTimeout),
      // });
      //
      // if (!response.ok) {
      //   logger.warn('HMS verify endpoint returned error', {
      //     status: response.status,
      //     clientId,
      //   });
      //   return null;
      // }
      //
      // const verifyResult = await response.json();
      //
      // // Map HMS response to LaunchTokenPayload
      // return {
      //   sub: verifyResult.user_id || verifyResult.sub,
      //   hmsId: verifyResult.hms_id || hmsClient.hmsId,
      //   clientId,
      //   email: verifyResult.email,
      //   name: verifyResult.name,
      //   roles: verifyResult.roles,
      //   permissions: verifyResult.permissions,
      //   iat: Math.floor(Date.now() / 1000),
      //   exp: Math.floor(Date.now() / 1000) + 3600, // Default expiry
      // };

      logger.warn('HMS verify provider not yet implemented', { clientId });
      return null;
    } catch (error) {
      logger.error('HMS verify request failed', { error: (error as Error).message, clientId });
      return null;
    }
  }
}
