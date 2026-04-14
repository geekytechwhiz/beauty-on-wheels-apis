import { getEnvConfig } from './env';
import { getCachedExternalTenantByTenantId } from '../services/external-tenant.service';

export interface TenantHmsConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

let parsedTenantMap: Record<string, TenantHmsConfig> | null = null;

function parseTenantHmsConfig(): Record<string, TenantHmsConfig> {
  if (parsedTenantMap) return parsedTenantMap;
  const raw = process.env.TENANT_HMS_CONFIG;
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    parsedTenantMap = {};
    return parsedTenantMap;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, { baseUrl?: string; apiKey?: string; timeoutMs?: number }>;
    const result: Record<string, TenantHmsConfig> = {};
    for (const [tenantId, value] of Object.entries(parsed)) {
      if (value && typeof value.baseUrl === 'string' && typeof value.apiKey === 'string') {
        result[tenantId] = {
          baseUrl: value.baseUrl,
          apiKey: value.apiKey,
          timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
        };
      }
    }
    parsedTenantMap = result;
    return parsedTenantMap;
  } catch {
    parsedTenantMap = {};
    return parsedTenantMap;
  }
}

/**
 * Returns HMS (TruTech) configuration for the given tenant.
 * Prefers Organization Service tenant cache; then TENANT_HMS_CONFIG.
 * Throws when tenant-specific config is unavailable.
 */
export function getTenantHmsConfig(tenantId: string): TenantHmsConfig {
  const env = getEnvConfig();
  const cachedTenant = getCachedExternalTenantByTenantId(env.PROVIDER, tenantId);
  if (cachedTenant) {
    return {
      baseUrl: cachedTenant.apiBaseUrl,
      apiKey: cachedTenant.apiKey,
      timeoutMs: env.TRU_TECH_TIMEOUT_MS,
    };
  }

  const map = parseTenantHmsConfig();
  const tenantConfig = map[tenantId];
  if (tenantConfig) return tenantConfig;

  throw new Error(`HMS config not found for tenant: ${tenantId}`);
}
