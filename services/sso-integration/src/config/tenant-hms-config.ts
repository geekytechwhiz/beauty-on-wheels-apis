import { getEnvConfig } from './env';

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
 * If TENANT_HMS_CONFIG is set and contains the tenant, returns that config.
 * Otherwise returns the default global TRU_TECH_* env config.
 */
export function getTenantHmsConfig(tenantId: string): TenantHmsConfig {
  const map = parseTenantHmsConfig();
  const tenantConfig = map[tenantId];
  if (tenantConfig) return tenantConfig;
  const env = getEnvConfig();
  return {
    baseUrl: env.TRU_TECH_BASE_URL,
    apiKey: env.TRU_TECH_API_KEY,
    timeoutMs: env.TRU_TECH_TIMEOUT_MS,
  };
}
