/**
 * Read-only client for Partner Registry.
 * Loads partner config by id (for webhook auth and adapter resolution).
 */

export interface PartnerConfig {
  partnerId: string;
  name: string;
  status: string;
  displayName?: string;
  description?: string;
  endpoints?: Array<{ type: string; url: string; description?: string }>;
  createdAt?: string;
  updatedAt?: string;
}

export async function getPartnerConfig(
  partnerId: string,
  baseUrl: string
): Promise<PartnerConfig | null> {
  // TODO: call GET ${baseUrl}/partner/${partnerId} (e.g. axios.get), return parsed config or null
  if (!baseUrl) {
    return null;
  }
  const url = `${baseUrl.replace(/\/$/, '')}/partner/${encodeURIComponent(partnerId)}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Partner Registry returned ${res.status}`);
    }
    const data = (await res.json()) as { data?: PartnerConfig; partner?: PartnerConfig };
    return data?.data ?? data?.partner ?? (data as unknown as PartnerConfig) ?? null;
  } catch {
    return null;
  }
}
