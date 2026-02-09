/**
 * In-memory JWKS cache for Lambda Authorizer.
 * Survives warm executions; avoids network calls on cache hit.
 * No Redis or external cache.
 */

import * as https from 'https';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jwkToPem = require('jwk-to-pem') as (jwk: { kty: string; n: string; e: string }) => string;

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

let cachedPems: PemMap | null = null;
let cachedJwksUrl: string | null = null;

/**
 * Fetches JWKS from URL and returns PEMs keyed by kid.
 * Uses module-level cache keyed by JWKS URL.
 */
function fetchJwksPems(jwksUrl: string): Promise<PemMap> {
  return new Promise((resolve, reject) => {
    https
      .get(jwksUrl, (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
          data += chunk;
        });
        resp.on('end', () => {
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
      })
      .on('error', (err) => {
        reject(new Error('JWKS fetch failed: ' + (err as Error).message));
      });
  });
}

/**
 * Returns PEM map for the given JWKS URL. Cached in memory per URL.
 * Safe to call repeatedly; only fetches when cache is empty or URL changed.
 */
export async function getPemsForJwksUrl(jwksUrl: string): Promise<PemMap> {
  if (cachedPems && cachedJwksUrl === jwksUrl) {
    return cachedPems;
  }
  const pems = await fetchJwksPems(jwksUrl);
  cachedPems = pems;
  cachedJwksUrl = jwksUrl;
  return pems;
}

/**
 * Builds Cognito JWKS URL from user pool ID and region.
 */
export function getCognitoJwksUrl(userPoolId: string, region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
}
