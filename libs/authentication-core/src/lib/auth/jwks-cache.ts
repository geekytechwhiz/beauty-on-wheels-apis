import { UnauthorizedError } from '@api-hub/utils';

export interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

// jwk-to-pem is CJS (`export =`). require() works in Jest and the Lambda bundle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jwkToPem = require('jwk-to-pem') as (jwk: Jwk) => string;

export interface JwksDocument {
  keys: Jwk[];
}

export type JwksFetcher = (uri: string) => Promise<JwksDocument>;

const DEFAULT_TTL_MS = 60 * 60 * 1000;

async function defaultFetcher(uri: string): Promise<JwksDocument> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new UnauthorizedError('Unable to validate token');
  }
  return (await response.json()) as JwksDocument;
}

export class JwksCache {
  private pemByKid = new Map<string, string>();
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly jwksUri: string,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly fetcher: JwksFetcher = defaultFetcher,
  ) {}

  async getPem(kid: string): Promise<string> {
    const cached = this.pemByKid.get(kid);
    if (cached && !this.isStale()) {
      return cached;
    }

    await this.refresh();
    const pem = this.pemByKid.get(kid);
    if (pem) {
      return pem;
    }

    // Signing-key rotation: force a refresh once more on unknown kid.
    await this.refresh(true);
    const rotated = this.pemByKid.get(kid);
    if (!rotated) {
      throw new UnauthorizedError('Unable to validate token');
    }
    return rotated;
  }

  clear(): void {
    this.pemByKid.clear();
    this.fetchedAt = 0;
  }

  private isStale(): boolean {
    return Date.now() - this.fetchedAt >= this.ttlMs;
  }

  private async refresh(force = false): Promise<void> {
    if (!force && !this.isStale() && this.pemByKid.size > 0) {
      return;
    }
    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.loadKeys().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async loadKeys(): Promise<void> {
    const document = await this.fetcher(this.jwksUri);
    const next = new Map<string, string>();
    for (const jwk of document.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA') {
        continue;
      }
      next.set(jwk.kid, jwkToPem(jwk));
    }
    this.pemByKid = next;
    this.fetchedAt = Date.now();
  }
}

const caches = new Map<string, JwksCache>();

export function getJwksCache(
  jwksUri: string,
  options?: { ttlMs?: number; fetcher?: JwksFetcher },
): JwksCache {
  const existing = caches.get(jwksUri);
  if (existing && !options?.fetcher) {
    return existing;
  }
  const created = new JwksCache(
    jwksUri,
    options?.ttlMs,
    options?.fetcher,
  );
  if (!options?.fetcher) {
    caches.set(jwksUri, created);
  }
  return created;
}

export function clearJwksCaches(): void {
  for (const cache of caches.values()) {
    cache.clear();
  }
  caches.clear();
}
