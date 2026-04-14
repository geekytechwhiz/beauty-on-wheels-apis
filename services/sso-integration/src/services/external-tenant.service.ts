import axios from 'axios';
import { getEnvConfig } from '../config/env';

export type ExternalTenant = {
  tenantId: string;
  organizationId: string;
  subdomain: string;
  apiBaseUrl: string;
  provider: string;
  sourceSystem?: string;
  apiKey: string;
};

type ExternalTenantApiResponse = {
  data?: {
    items?: ExternalTenant[];
  };
};

const cache = new Map<string, ExternalTenant[]>();

export function getCachedExternalTenantByTenantId(
  provider: string,
  tenantId: string,
): ExternalTenant | undefined {
  const list = cache.get(provider) ?? [];
  return list.find(
    (item) => item.tenantId === tenantId || item.subdomain === tenantId,
  );
}

export async function getExternalTenantsByProvider(
  provider: string,
): Promise<ExternalTenant[]> {
  const env = getEnvConfig();

  const response = await axios.post<ExternalTenantApiResponse>(
    `${env.ORGANIZATION_SERVICE_BASE_URL}/organization/get-external-tenant`,
    { provider },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: env.TRU_TECH_TIMEOUT_MS,
    },
  );

  const items = response.data?.data?.items ?? [];
  cache.set(provider, items);
  return items;
}

