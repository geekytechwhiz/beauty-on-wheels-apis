import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { LambdaRequest } from '@api-hub/utils';

import { authenticate } from './authenticate';
import { authorize } from './authorize';
import { JwksCache, type JwksDocument } from './jwks-cache';
import type { AuthUserDirectory } from './auth-context';
import { PERMISSION } from './permissions';
import type { CognitoConfig } from '../config/cognito.config';

const POOL_ID = 'us-east-1_testpool';
const CLIENT_ID = 'test-app-client';
const REGION = 'us-east-1';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: 'jwk' });
const document: JwksDocument = {
  keys: [{ ...jwk, kid: 'kid-1', kty: 'RSA' }],
};

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

function signToken(claims: Record<string, unknown> = {}): string {
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
      keyid: 'kid-1',
    },
  );
}

function requestWithAuth(header?: string): LambdaRequest {
  return {
    event: {} as LambdaRequest['event'],
    params: {},
    body: {},
    context: {
      correlationId: 'c-1',
      awsRequestId: 'a-1',
      logger: {},
      authHeader: header,
    },
  };
}

const cache = new JwksCache(config.jwksUri, 60_000, async () => document);

jest.mock('./jwks-cache', () => {
  const actual = jest.requireActual('./jwks-cache');
  return {
    ...actual,
    getJwksCache: () => cache,
  };
});

function directory(overrides?: Partial<AuthUserDirectory>): AuthUserDirectory {
  return {
    findUserByIdentityId: jest.fn().mockResolvedValue({
      userId: 'u-1',
      identityId: 'cognito-sub-1',
      roleId: 'vendor',
      status: 'active',
    }),
    getUserRoles: jest.fn().mockResolvedValue(['vendor']),
    getPermissionsForRoles: jest.fn().mockResolvedValue([PERMISSION.VENDOR_READ]),
    ...overrides,
  };
}

describe('authenticate', () => {
  it('rejects a missing Authorization header', async () => {
    await expect(authenticate(requestWithAuth())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects an invalid Authorization format', async () => {
    await expect(authenticate(requestWithAuth('Basic abc'))).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('uses application roles from the access token instead of the directory role', async () => {
    const userDirectory = directory({
      findUserByIdentityId: jest.fn().mockResolvedValue({
        userId: 'u-1',
        identityId: 'cognito-sub-1',
        roleId: 'user',
        status: 'active',
      }),
      getUserRoles: jest.fn().mockResolvedValue(['user']),
      getPermissionsForRoles: jest.fn().mockResolvedValue([PERMISSION.VENDOR_READ]),
    });
    const token = signToken({
      roles: ['CUSTOMER', 'VENDOR'],
      scope: 'aws.cognito.signin.user.admin',
    });
    const ctx = await authenticate(requestWithAuth(`Bearer ${token}`), {
      userDirectory,
    });
    expect(ctx.identityId).toBe('cognito-sub-1');
    expect(ctx.roles).toEqual(['CUSTOMER', 'VENDOR']);
    expect(userDirectory.getUserRoles).not.toHaveBeenCalled();
    expect(userDirectory.getPermissionsForRoles).toHaveBeenCalledWith([
      'CUSTOMER',
      'VENDOR',
    ]);
  });

  it('keeps directory roles when the access token has no application role', async () => {
    const userDirectory = directory({
      getUserRoles: jest.fn().mockResolvedValue(['user']),
    });
    const token = signToken({ scope: 'aws.cognito.signin.user.admin' });
    const ctx = await authenticate(requestWithAuth(`Bearer ${token}`), {
      userDirectory,
    });
    expect(ctx.roles).toEqual(['user']);
    expect(ctx.roles).not.toContain('aws.cognito.signin.user.admin');
  });

  it('returns AuthContext for a valid Cognito token', async () => {
    const token = signToken();
    const req = requestWithAuth(`Bearer ${token}`);
    const ctx = await authenticate(req, { userDirectory: directory() });
    expect(ctx.identityId).toBe('cognito-sub-1');
    expect(ctx.userId).toBe('u-1');
    expect(ctx.roles).toEqual(['vendor']);
    expect(ctx.permissions).toEqual([PERMISSION.VENDOR_READ]);
    expect(req.context.authContext?.identityId).toBe('cognito-sub-1');
    expect(req.context.userContext?.userId).toBe('u-1');
  });

  it('hydrates AuthContext from API Gateway authorizer context without re-validating JWT', async () => {
    const req = requestWithAuth();
    req.event = {
      requestContext: {
        authorizer: {
          identityId: 'cognito-sub-1',
          userId: 'u-1',
          roles: JSON.stringify(['vendor']),
          permissions: JSON.stringify([PERMISSION.VENDOR_READ]),
        },
      },
    } as LambdaRequest['event'];

    const ctx = await authenticate(req);
    expect(ctx.identityId).toBe('cognito-sub-1');
    expect(ctx.userId).toBe('u-1');
    expect(ctx.roles).toEqual(['vendor']);
    expect(ctx.permissions).toEqual([PERMISSION.VENDOR_READ]);
  });

  it('resolves the application user when authorizer context has identityId but no userId', async () => {
    const req = requestWithAuth();
    req.event = {
      requestContext: {
        authorizer: {
          identityId: 'cognito-sub-1',
        },
      },
    } as LambdaRequest['event'];

    const ctx = await authenticate(req, { userDirectory: directory() });
    expect(ctx.userId).toBe('u-1');
    expect(ctx.roles).toEqual(['vendor']);
    expect(req.context.userContext?.userId).toBe('u-1');
  });

  it('returns 403 when the application user mapping is missing', async () => {
    const token = signToken();
    const req = requestWithAuth(`Bearer ${token}`);
    await expect(
      authenticate(req, {
        userDirectory: directory({
          findUserByIdentityId: jest.fn().mockResolvedValue(null),
        }),
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'APPLICATION_USER_NOT_FOUND',
      metadata: expect.objectContaining({ identityId: 'cognito-sub-1' }),
    });
  });
});

describe('authorize', () => {
  it('uses access-token roles for authorization and still accepts a token without roles', async () => {
    const withRoles = signToken({
      roles: ['ADMIN'],
      scope: 'aws.cognito.signin.user.admin',
    });
    const userDirectory = directory({
      getUserRoles: jest.fn().mockResolvedValue(['user']),
      getPermissionsForRoles: jest.fn().mockResolvedValue([PERMISSION.VENDOR_READ]),
    });
    const ctx = await authorize(
      requestWithAuth(`Bearer ${withRoles}`),
      { permissions: [PERMISSION.VENDOR_READ] },
      { userDirectory },
    );
    expect(ctx.roles).toEqual(['ADMIN']);
    expect(userDirectory.getUserRoles).not.toHaveBeenCalled();
    expect(userDirectory.getPermissionsForRoles).toHaveBeenCalledWith(['ADMIN']);
    expect(ctx.roles).not.toContain('aws.cognito.signin.user.admin');

    const legacy = signToken({ scope: 'openid' });
    const legacyDirectory = directory({
      getUserRoles: jest.fn().mockResolvedValue(['user']),
      getPermissionsForRoles: jest.fn().mockResolvedValue([]),
    });
    const legacyCtx = await authenticate(requestWithAuth(`Bearer ${legacy}`), {
      userDirectory: legacyDirectory,
    });
    expect(legacyCtx.roles).toEqual(['user']);
    expect(legacyCtx.roles).not.toContain('CUSTOMER');
    expect(legacyCtx.roles).not.toContain('VENDOR');
    expect(legacyCtx.roles).not.toContain('ADMIN');
  });

  it('allows an authenticated user with the required permission', async () => {
    const token = signToken();
    const req = requestWithAuth(`Bearer ${token}`);
    const ctx = await authorize(
      req,
      { permissions: [PERMISSION.VENDOR_READ] },
      { userDirectory: directory() },
    );
    expect(ctx.userId).toBe('u-1');
  });

  it('denies an authenticated user without the required permission', async () => {
    const token = signToken();
    const req = requestWithAuth(`Bearer ${token}`);
    await expect(
      authorize(
        req,
        { permissions: [PERMISSION.VEHICLE_DELETE] },
        { userDirectory: directory() },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('unions permissions across multiple roles', async () => {
    const token = signToken();
    const req = requestWithAuth(`Bearer ${token}`);
    const ctx = await authorize(
      req,
      { permissions: [PERMISSION.VENDOR_READ, PERMISSION.BOOKING_READ] },
      {
        userDirectory: directory({
          getUserRoles: jest.fn().mockResolvedValue(['vendor', 'dispatcher']),
          getPermissionsForRoles: jest.fn().mockResolvedValue([
            PERMISSION.VENDOR_READ,
            PERMISSION.BOOKING_READ,
          ]),
        }),
      },
    );
    expect(ctx.permissions).toEqual(
      expect.arrayContaining([PERMISSION.VENDOR_READ, PERMISSION.BOOKING_READ]),
    );
  });

  it('allows when the user holds multiple permissions including the required one', async () => {
    const token = signToken();
    const req = requestWithAuth(`Bearer ${token}`);
    await expect(
      authorize(
        req,
        { permissions: [PERMISSION.VENDOR_READ] },
        {
          userDirectory: directory({
            getPermissionsForRoles: jest.fn().mockResolvedValue([
              PERMISSION.VENDOR_READ,
              PERMISSION.VENDOR_UPDATE,
            ]),
          }),
        },
      ),
    ).resolves.toMatchObject({ userId: 'u-1' });
  });
});
