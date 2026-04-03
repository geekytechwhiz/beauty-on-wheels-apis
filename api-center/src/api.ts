/**
 * API Aggregator + Registry — HTTP API (Serverless).
 *
 * Endpoints (relative to `VITE_API_BASE_URL`, no trailing slash):
 * - GET  /health
 * - GET  /services
 * - POST /services
 * - GET  /specs
 * - GET  /specs/{service}  (?version= optional)
 *
 * Local: omit `VITE_API_BASE_URL` to use Vite proxy `/api` → http://localhost:4000
 * Deployed: set `VITE_API_BASE_URL` or run `pnpm dev:registry`.
 */

export interface ServiceVersionRecord {
  url: string;
}

/** Matches GET /services response from api-aggregator-registry */
export interface ServiceRegistryEntry {
  name: string;
  latest: string;
  versions: Record<string, ServiceVersionRecord>;
  module?: string;
  rules?: string[];
}

export interface HealthResponse {
  status: string;
  service: string;
  servicesRegistered: number;
  timestamp: string;
}

export interface RegisterServicePayload {
  name: string;
  url: string;
  version?: string;
  module?: string;
  rules?: string[];
}

export function getApiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (raw !== undefined && raw !== '') {
    return raw.replace(/\/$/, '').replace(/^['"]|['"]$/g, '');
  }
  return '/api';
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${p}`;
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || `${res.status} ${res.statusText}`;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      message = j.message ?? j.error ?? message;
    } catch {
      // keep text
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>('/health');
}

export async function fetchServices(): Promise<ServiceRegistryEntry[]> {
  return fetchJson<ServiceRegistryEntry[]>('/services');
}

export async function fetchMergedSpec(): Promise<object> {
  return fetchJson<object>('/specs');
}

export async function fetchServiceSpec(
  serviceName: string,
  version?: string,
): Promise<object> {
  const q = version ? `?version=${encodeURIComponent(version)}` : '';
  return fetchJson<object>(`/specs/${encodeURIComponent(serviceName)}${q}`);
}

export async function registerService(
  payload: RegisterServicePayload,
): Promise<ServiceRegistryEntry> {
  return fetchJson<ServiceRegistryEntry>('/services', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Secondary line for sidebar: module or latest + short URL hint */
export function serviceListSecondary(s: ServiceRegistryEntry): string {
  const url = s.versions[s.latest]?.url ?? '';
  if (s.module) return `${s.module} · ${s.latest}`;
  if (url) return `${s.latest} · ${truncateMiddle(url, 42)}`;
  return s.latest;
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 3) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}
