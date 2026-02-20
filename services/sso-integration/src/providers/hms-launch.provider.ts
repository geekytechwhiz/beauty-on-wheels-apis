/**
 * HMS Launch Provider Interface
 * 
 * Abstraction for different HMS launch token verification strategies.
 * Allows supporting multiple HMS providers (local JWT, remote /verify endpoint, etc.)
 */

import { LaunchTokenPayload } from '../types';

/**
 * Interface for HMS launch token verification providers
 */
export interface IHMSLaunchProvider {
  /**
   * Verify a launch token and return the payload if valid
   * @param launchToken - The launch token to verify
   * @param clientId - The HMS client ID (may be needed for provider-specific config)
   * @returns Launch token payload if valid, null if invalid
   */
  verifyLaunchToken(launchToken: string, clientId: string): Promise<LaunchTokenPayload | null>;

  /**
   * Get the provider name/type (for logging/debugging)
   */
  getProviderType(): string;
}
