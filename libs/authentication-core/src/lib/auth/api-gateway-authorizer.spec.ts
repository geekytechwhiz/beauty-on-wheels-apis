import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { evaluateApiGatewayAuthorizer, toExecuteApiWildcardResource } from './api-gateway-authorizer';
import { JwksCache, type JwksDocument } from './jwks-cache';
import type { AuthUserDirectory } from './auth-context';
import { PERMISSION } from './permissions';
import type { CognitoConfig } from '../config/cognito.config';

const POOL_ID = 'us-east-1_testpool';
const CLIENT_ID = 'test-app-client';
const REGION = 'us-east-1';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const METHOD_ARN =
  'arn:aws:execute-api:us-east-1:123456789012:abcdef123/dev/GET/vendors';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: 'jwk' });
const document: JwksDocument = {
  keys: [{ ...jwk, kid: 'kid-1', kty: 'RSA' }],
};
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const config: CognitoConfig = {
  region: REGION,
  userPoolId: POOL_ID,
  appClientId: CLIENT_ID,
  issuer: ISSUER,
  jwksUri: 'https://example.test/jwks.json',
};

jest.mock('../config/cognito.config', () => ({
  getCognitoConfig: () => config,
}));

const cache = new JwksCache(config.jwksUri, 60_000, async () => document);

jest.mock('./jwks-cache', () => {
  const actual = jest.requireActual('./jwks-cache');
  return {
    ...actual,
    getJwksCache: () => cache,
  };
});

function signToken(
  claims: Record<string, unknown> = {},
  options: jwt.SignOptions = {},
  key: crypto.KeyObject = privateKey,
): string {
  return jwt.sign(
    {
      sub: 'cognito-sub-1',
      token_use: 'access',
      client_id: CLIENT_ID,
      roles: ['VENDOR'],
      ...claims,
    },
    key,
    {
      algorithm: 'RS256',
      issuer: ISSUER,
      expiresIn: '15m',
      keyid: 'kid-1',
      ...options,
    },
  );
}

function directory(overrides?: Partial<AuthUserDirectory>): AuthUserDirectory {
  return {
    findUserByIdentityId: jest.fn().mockResolvedValue({
      userId: 'u-1',
      identityId: 'cognito-sub-1',
      roleId: 'VENDOR',
      status: 'active',
    }),
    getUserRoles: jest.fn().mockResolvedValue(['VENDOR']),
    getPermissionsForRoles: jest.fn().mockResolvedValue([PERMISSION.VENDOR_READ]),
    ...overrides,
  };
}

function event(authorizationToken?: string) {
  return {
    type: 'TOKEN',
    methodArn: METHOD_ARN,
    authorizationToken,
  };
}

function statement(result: Awaited<ReturnType<typeof evaluateApiGatewayAuthorizer>>) {
  return result.policyDocument.Statement[0];
}

describe('evaluateApiGatewayAuthorizer', () => {
  it('throws Unauthorized for a missing token', async () => {
    await expect(
      evaluateApiGatewayAuthorizer(event(undefined), {
        userDirectory: directory(),
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized for a malformed token', async () => {
    await expect(
      evaluateApiGatewayAuthorizer(event('Bearer not-a-jwt'), {
        userDirectory: directory(),
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized for a token with an invalid signature', async () => {
    const token = signToken({}, {}, other.privateKey);
    await expect(
      evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
        userDirectory: directory(),
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized for an expired token', async () => {
    const token = signToken({}, { expiresIn: '-10s' });
    await expect(
      evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
        userDirectory: directory(),
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized for an invalid issuer', async () => {
    const token = signToken(
      {},
      { issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wrong' },
    );
    await expect(
      evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
        userDirectory: directory(),
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized for a token from the wrong User Pool', async () => {
    const token = signToken(
      {},
      { issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OtherPool' },
    );
    await expect(
      evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
        userDirectory: directory(),
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized for a token from the wrong App Client', async () => {
    const token = signToken({ client_id: 'wrong-client' });
    await expect(
      evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
        userDirectory: directory(),
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized for an ID token when access tokens are required', async () => {
    const token = signToken({ token_use: 'id', aud: CLIENT_ID, client_id: undefined });
    await expect(
      evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
        userDirectory: directory(),
        expectedTokenUse: 'access',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('allows a valid ID token by default', async () => {
    const token = signToken({ token_use: 'id', aud: CLIENT_ID, client_id: undefined });
    const result = await evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
      userDirectory: directory(),
    });
    expect(result.principalId).toBe('cognito-sub-1');
    expect(statement(result).Effect).toBe('Allow');
  });

  it('allows a raw JWT without a Bearer prefix', async () => {
    const token = signToken();
    const result = await evaluateApiGatewayAuthorizer(event(token), {
      userDirectory: directory(),
    });
    expect(statement(result).Effect).toBe('Allow');
  });

  it('reads Authorization from REQUEST-style headers', async () => {
    const token = signToken();
    const result = await evaluateApiGatewayAuthorizer(
      {
        type: 'REQUEST',
        methodArn: METHOD_ARN,
        headers: { Authorization: `Bearer ${token}` },
      },
      { userDirectory: directory() },
    );
    expect(statement(result).Effect).toBe('Allow');
  });

  it('allows a valid access token and returns downstream context', async () => {
    const token = signToken();
    const result = await evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
      userDirectory: directory(),
    });

    expect(result.principalId).toBe('cognito-sub-1');
    expect(statement(result)).toMatchObject({
      Effect: 'Allow',
      Action: 'execute-api:Invoke',
      Resource: 'arn:aws:execute-api:us-east-1:123456789012:abcdef123/dev/*/*',
    });
    expect(result.context).toEqual({
      identityId: 'cognito-sub-1',
      userId: 'u-1',
      roles: JSON.stringify(['VENDOR']),
      permissions: JSON.stringify([PERMISSION.VENDOR_READ]),
    });
  });

  it('denies when the application user mapping is missing', async () => {
    const token = signToken();
    const result = await evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
      userDirectory: directory({
        findUserByIdentityId: jest.fn().mockResolvedValue(null),
      }),
    });
    expect(statement(result).Effect).toBe('Deny');
    expect(statement(result).Resource).toBe(
      'arn:aws:execute-api:us-east-1:123456789012:abcdef123/dev/*/*',
    );
  });

  it('allows an authenticated user who has no permissions (no resource-level check)', async () => {
    const token = signToken();
    const result = await evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
      userDirectory: directory({
        getPermissionsForRoles: jest.fn().mockResolvedValue([]),
      }),
    });
    expect(statement(result).Effect).toBe('Allow');
    expect(result.context?.permissions).toBe('[]');
    expect(result.context?.identityId).toBe('cognito-sub-1');
    expect(result.context?.userId).toBe('u-1');
  });

  it('returns Allow with roles and permissions on successful authorization', async () => {
    const token = signToken();
    const result = await evaluateApiGatewayAuthorizer(event(`Bearer ${token}`), {
      userDirectory: directory({
        getUserRoles: jest.fn().mockResolvedValue(['VENDOR', 'dispatcher']),
        getPermissionsForRoles: jest.fn().mockResolvedValue([
          PERMISSION.VENDOR_READ,
          PERMISSION.BOOKING_READ,
        ]),
      }),
    });
    expect(statement(result).Effect).toBe('Allow');
    expect(result.context).toEqual({
      identityId: 'cognito-sub-1',
      userId: 'u-1',
      roles: JSON.stringify(['VENDOR']),
      permissions: JSON.stringify([PERMISSION.VENDOR_READ, PERMISSION.BOOKING_READ]),
    });
  });
});

describe('toExecuteApiWildcardResource', () => {
  it('covers verb and path for a TOKEN-authorizer cached Allow', () => {
    expect(toExecuteApiWildcardResource(METHOD_ARN)).toBe(
      'arn:aws:execute-api:us-east-1:123456789012:abcdef123/dev/*/*',
    );
  });

  it('keeps a stage-wide resource for nested API paths', () => {
    expect(
      toExecuteApiWildcardResource(
        'arn:aws:execute-api:us-east-1:123456789012:abcdef123/dev/PUT/vendors/vid/onboarding',
      ),
    ).toBe('arn:aws:execute-api:us-east-1:123456789012:abcdef123/dev/*/*');
  });
});
