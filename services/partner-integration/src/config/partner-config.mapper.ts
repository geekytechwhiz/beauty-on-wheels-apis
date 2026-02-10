/**
 * Maps Partner Registry config to lab-integration lib PartnerConfig.
 * Keeps the service as the single place that talks to Partner Registry;
 * the lib stays agnostic of registry and receives a normalized config.
 */

import type { PartnerConfig as LibPartnerConfig } from '@api-hub/lab-integration';
import type { PartnerConfig as RegistryPartnerConfig } from '../adapters/partner.adapter';

export function mapRegistryConfigToLibConfig(
  registry: RegistryPartnerConfig
): LibPartnerConfig {
  const adapterKey =
    registry.adapterKey?.toLowerCase().trim() ?? registry.partnerId.toLowerCase().trim();
  return {
    partnerId: registry.partnerId,
    partnerName: registry.partnerId,
    adapterKey,
    baseUrl: registry.apiBaseUrl.replace(/\/$/, ''),
    authConfig: registry.authConfig
      ? { credentialsSecretArn: registry.authConfig.credentialsSecretArn }
      : undefined,
    timeout: 10000,
    circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeoutMs: 60000 },
  };
}
