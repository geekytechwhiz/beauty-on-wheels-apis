import NodeCache from 'node-cache';

const ttlSeconds = Number(process.env.CACHE_TTL_SECONDS || 60);

const cache = new NodeCache({
  stdTTL: ttlSeconds,
  checkperiod: Math.max(10, Math.floor(ttlSeconds / 2)),
});

interface CachePayload {
  mergedSpec?: unknown;
  individualSpecs: Record<string, unknown>;
  lastUpdated?: string;
}

const CACHE_KEY = 'aggregator-cache';

function getPayload(): CachePayload {
  return (
    (cache.get(CACHE_KEY) as CachePayload | undefined) ?? {
      individualSpecs: {},
    }
  );
}

function setPayload(payload: CachePayload): void {
  cache.set(CACHE_KEY, payload);
}

export function getMergedSpecFromCache(): unknown | undefined {
  return getPayload().mergedSpec;
}

export function setMergedSpecCache(spec: unknown): void {
  const payload = getPayload();
  payload.mergedSpec = spec;
  payload.lastUpdated = new Date().toISOString();
  setPayload(payload);
}

export function getIndividualSpecFromCache(key: string): unknown | undefined {
  return getPayload().individualSpecs[key];
}

export function setIndividualSpecCache(key: string, spec: unknown): void {
  const payload = getPayload();
  payload.individualSpecs[key] = spec;
  payload.lastUpdated = new Date().toISOString();
  setPayload(payload);
}

export function clearAggregatorCache(): void {
  cache.del(CACHE_KEY);
}
