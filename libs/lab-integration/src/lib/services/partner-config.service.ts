import type { PartnerConfig } from '../adapters/base/adapter.interface';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const configCache = new Map<
  string,
  { config: PartnerConfig; timestamp: number }
>();

/**
 * Mock implementation - replace with actual Partner Registry API call.
 */
async function fetchPartnerConfigFromRegistry(
  partnerId: string
): Promise<PartnerConfig> {
  const configs: Record<string, PartnerConfig> = {
    redcliffe: {
      partnerId: 'redcliffe',
      partnerName: 'Redcliffe Labs',
      adapterKey: 'redcliffe',
      baseUrl:
        process.env.REDCLIFFE_BASE_URL ?? 'https://api.redcliffelabs.com',
      authConfig: {
        credentialsSecretArn: process.env.REDCLIFFE_SECRET_ARN ?? '',
      },
      timeout: 10000,
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeoutMs: 60000,
      },
    },
    orange: {
      partnerId: 'orange',
      partnerName: 'Orange Health',
      adapterKey: 'orange',
      baseUrl:
        process.env.ORANGE_BASE_URL ?? 'https://sandbox-partner-api.orangehealth.dev',
      authConfig: {
        credentialsSecretArn: process.env.ORANGE_SECRET_ARN ?? '',
      },
      timeout: 10000,
      circuitBreaker: {
        enabled: true,
      },
    },
  };

  const config = configs[partnerId.toLowerCase()];
  if (!config) {
    throw new Error(`Partner configuration not found: ${partnerId}`);
  }

  return config;
}

/**
 * Service to fetch partner configuration.
 * In production, this would call the Partner Registry service.
 *
 * SLA: Expected latency < 100ms, availability > 99.9%
 * Caching: Results cached in-memory with 5-minute TTL
 *
 * @param partnerId - Unique partner identifier
 * @returns Partner configuration
 * @throws Error if partner not found or service unavailable
 */
export async function getPartnerConfig(
  partnerId: string
): Promise<PartnerConfig> {
  const cached = configCache.get(partnerId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.config;
  }

  const config = await fetchPartnerConfigFromRegistry(partnerId);

  configCache.set(partnerId, {
    config,
    timestamp: Date.now(),
  });

  return config;
}

/**
 * Clear cache for a specific partner or all partners.
 */
export function clearConfigCache(partnerId?: string): void {
  if (partnerId) {
    configCache.delete(partnerId);
  } else {
    configCache.clear();
  }
}
