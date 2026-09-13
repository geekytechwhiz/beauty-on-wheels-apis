import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { JwksCache, type JwksDocument } from './jwks-cache';
import { validateAccessToken, readBearerToken } from './token-validator';
import type { CognitoConfig } from '../config/cognito.config';

const POOL_ID = 'us-east-1_testpool';
const CLIENT_ID = 'test-app-client';
const REGION = 'us-east-1';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;

function createSigner(kid = 'kid-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const document: JwksDocument = {
    keys: [{ ...jwk, kid, kty: 'RSA' }],
  };
  return { privateKey, kid, document };
}

function signAccessToken(
  privateKey: crypto.KeyObject,
  kid: string,
  claims: Record<string, unknown> = {},
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(
    {
      sub: 'cognito-sub-1',
      token_use: 'access',
      client_id: CLIENT_ID,
      ...claims,
    },
    privateKey,
    {
      algorithm: 'RS256',
      issuer: ISSUER,
      expiresIn: '15m',
      keyid: kid,
      ...options,
    },
  );
}

describe('readBearerToken', () => {
  it('rejects a missing Authorization header', () => {
    expect(() => readBearerToken(undefined)).toThrow('Missing Authorization header');
  });

  it('rejects an invalid Authorization format', () => {
    expect(() => readBearerToken('Token abc')).toThrow('Invalid Authorization format');
    expect(() => readBearerToken('Bearer')).toThrow('Invalid Authorization format');
  });

  it('extracts a Bearer token', () => {
    expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('extracts a raw JWT without a Bearer scheme', () => {
    expect(readBearerToken('abc.def.ghi')).toBe('abc.def.ghi');
  });
});

describe('validateAccessToken', () => {
  const { privateKey, kid, document } = createSigner();
  const other = createSigner('other-kid');
  const config: CognitoConfig = {
    region: REGION,
    userPoolId: POOL_ID,
    appClientId: CLIENT_ID,
    issuer: ISSUER,
    jwksUri: 'https://example.test/jwks.json',
  };
  const cache = new JwksCache(config.jwksUri, 60_000, async () => document);

  it('rejects a malformed JWT', async () => {
    await expect(validateAccessToken('not-a-jwt', { config, jwksCache: cache })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects a token with an invalid signature', async () => {
    const token = signAccessToken(other.privateKey, kid);
    await expect(validateAccessToken(token, { config, jwksCache: cache })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects an expired token', async () => {
    const token = signAccessToken(privateKey, kid, {}, { expiresIn: '-10s' });
    await expect(validateAccessToken(token, { config, jwksCache: cache })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects an invalid issuer', async () => {
    const token = signAccessToken(privateKey, kid, {}, {
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wrong',
    });
    await expect(validateAccessToken(token, { config, jwksCache: cache })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects a token from the wrong user pool', async () => {
    const token = signAccessToken(privateKey, kid, {}, {
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OtherPool',
    });
    await expect(validateAccessToken(token, { config, jwksCache: cache })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects the wrong audience/client', async () => {
    const token = signAccessToken(privateKey, kid, { client_id: 'wrong-client' });
    await expect(validateAccessToken(token, { config, jwksCache: cache })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('accepts a valid Cognito access token', async () => {
    const token = signAccessToken(privateKey, kid);
    const payload = await validateAccessToken(token, { config, jwksCache: cache });
    expect(payload.sub).toBe('cognito-sub-1');
    expect(payload.iss).toBe(ISSUER);
  });

  it('accepts an ID token when token_use is not restricted', async () => {
    const token = signAccessToken(privateKey, kid, {
      token_use: 'id',
      aud: CLIENT_ID,
      client_id: undefined,
    });
    const payload = await validateAccessToken(token, { config, jwksCache: cache });
    expect(payload.sub).toBe('cognito-sub-1');
    expect(payload.token_use).toBe('id');
  });

  it('rejects an ID token when access tokens are required', async () => {
    const token = signAccessToken(privateKey, kid, {
      token_use: 'id',
      aud: CLIENT_ID,
    });
    await expect(
      validateAccessToken(token, {
        config,
        jwksCache: cache,
        expectedTokenUse: 'access',
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
