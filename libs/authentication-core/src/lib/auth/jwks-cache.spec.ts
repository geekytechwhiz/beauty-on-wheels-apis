import crypto from 'crypto';

import { JwksCache, type JwksDocument } from './jwks-cache';

function rsaJwk(kid: string) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { ...jwk, kid, kty: 'RSA' as const };
}

describe('JwksCache', () => {
  it('caches PEM keys and does not refetch within TTL', async () => {
    const document: JwksDocument = { keys: [rsaJwk('kid-1')] };
    const fetcher = jest.fn(async () => document);
    const cache = new JwksCache('https://example.test/jwks.json', 60_000, fetcher);

    const pem1 = await cache.getPem('kid-1');
    const pem2 = await cache.getPem('kid-1');

    expect(pem1).toContain('BEGIN PUBLIC KEY');
    expect(pem2).toBe(pem1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes when kid is unknown after rotation', async () => {
    const first: JwksDocument = { keys: [rsaJwk('kid-old')] };
    const second: JwksDocument = { keys: [rsaJwk('kid-new')] };
    let generation = 0;
    const fetcher = jest.fn(async () => {
      generation += 1;
      return generation === 1 ? first : second;
    });

    const cache = new JwksCache('https://example.test/jwks.json', 60_000, fetcher);
    const pem = await cache.getPem('kid-new');

    expect(pem).toContain('BEGIN PUBLIC KEY');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
