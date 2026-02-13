/**
 * In-memory JWKS cache for Lambda Authorizer.
 * Survives warm executions; avoids network calls on cache hit.
 * Cache has TTL; JWKS fetch has timeout for production resilience.
 */

import * as https from 'https';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jwkToPem = require('jwk-to-pem') as (jwk: { kty: string; n: string; e: string }) => string;

/** Default TTL for JWKS cache (Cognito key rotation). 10 minutes. */
const DEFAULT_JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

/** Default timeout for JWKS HTTP fetch. */
const DEFAULT_JWKS_FETCH_TIMEOUT_MS = 3000;

export interface JwksKey {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

export interface JwksDocument {
  keys: JwksKey[];
}

/** PEMs keyed by key id (kid). */
export type PemMap = Record<string, string>;

interface CacheEntry {
  pems: PemMap;
  expiresAt: number;
}

let cachedEntry: CacheEntry | null = null;
let cachedJwksUrl: string | null = null;

/**
 * Fetches JWKS from URL with timeout. Returns PEMs keyed by kid.
 */
function fetchJwksPems(jwksUrl: string, timeoutMs: number = DEFAULT_JWKS_FETCH_TIMEOUT_MS): Promise<PemMap> {
  return new Promise((resolve, reject) => {
    const req = https.get(jwksUrl, (resp) => {
      let data = '';
      resp.on('data', (chunk) => {
        data += chunk;
      });
      resp.on('end', () => {
        clearTimeout(timer);
        try {
          const body = JSON.parse(data) as JwksDocument;
          const keys = body.keys;
          if (!Array.isArray(keys)) {
            reject(new Error('JWKS keys not an array'));
            return;
          }
          const pems: PemMap = {};
          for (const key of keys) {
            const kid = key.kid;
            if (!kid) continue;
            const jwk = { kty: key.kty, n: key.n, e: key.e };
            pems[kid] = jwkToPem(jwk);
          }
          resolve(pems);
        } catch (err) {
          reject(err);
        }
      });
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`JWKS fetch timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('JWKS fetch failed: ' + err.message));
    });
  });
}

/**
 * Returns PEM map for the given JWKS URL. Cached in memory per URL with TTL.
 * Refetches when cache is empty, URL changed, or TTL expired.
 */
export async function getPemsForJwksUrl(
  jwksUrl: string,
  options?: { cacheTtlMs?: number; fetchTimeoutMs?: number }
): Promise<PemMap> {
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS;
  const fetchTimeoutMs = options?.fetchTimeoutMs ?? DEFAULT_JWKS_FETCH_TIMEOUT_MS;
  const now = Date.now();
  if (
    cachedEntry &&
    cachedJwksUrl === jwksUrl &&
    cachedEntry.expiresAt > now
  ) {
    return cachedEntry.pems;
  }
  const pems = await fetchJwksPems(jwksUrl, fetchTimeoutMs);
  cachedEntry = { pems, expiresAt: now + cacheTtlMs };
  cachedJwksUrl = jwksUrl;
  return pems;
}

/**
 * Builds Cognito JWKS URL from user pool ID and region.
 */
export function getCognitoJwksUrl(userPoolId: string, region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
}
