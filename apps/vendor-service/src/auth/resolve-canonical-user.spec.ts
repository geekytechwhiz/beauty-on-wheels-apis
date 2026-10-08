import { BaseError, LambdaRequest } from '@api-hub/utils';

import { ensureCanonicalUserId } from './resolve-canonical-user';
import type { AuthUserDirectory } from '@api-hub/authentication-core';

function request(context: Record<string, unknown> = {}): LambdaRequest {
  return {
    context,
  } as unknown as LambdaRequest;
}

describe('ensureCanonicalUserId', () => {
  const directory: jest.Mocked<AuthUserDirectory> = {
    findUserByIdentityId: jest.fn(),
    getUserRoles: jest.fn(),
    getPermissionsForRoles: jest.fn(),
  };

  beforeEach(() => {
    directory.findUserByIdentityId.mockReset();
  });

  it('keeps an application user id from the authorizer', async () => {
    const req = request({
      authContext: {
        identityId: 'cognito-sub-1',
        userId: 'u-93ea906d-4161-4f4b-871a-3fd42fa24ccc',
        roles: [],
        permissions: [],
        claims: {},
      },
      userContext: { identityId: 'cognito-sub-1' },
    });

    await expect(ensureCanonicalUserId(req, directory)).resolves.toBe(
      'u-93ea906d-4161-4f4b-871a-3fd42fa24ccc',
    );
    expect(directory.findUserByIdentityId).not.toHaveBeenCalled();
  });

  it('resolves identityId through the identity directory', async () => {
    directory.findUserByIdentityId.mockResolvedValue({
      userId: 'u-93ea906d-4161-4f4b-871a-3fd42fa24ccc',
      identityId: 'cognito-sub-1',
      status: 'active',
    });
    const req = request({
      authContext: {
        identityId: 'cognito-sub-1',
        roles: [],
        permissions: [],
        claims: {},
      },
      userContext: { userId: 'cognito-sub-1', identityId: 'cognito-sub-1' },
    });

    await expect(ensureCanonicalUserId(req, directory)).resolves.toBe(
      'u-93ea906d-4161-4f4b-871a-3fd42fa24ccc',
    );
    expect(req.context.userContext?.userId).toBe(
      'u-93ea906d-4161-4f4b-871a-3fd42fa24ccc',
    );
  });

  it('rejects a Cognito identity with no application user', async () => {
    directory.findUserByIdentityId.mockResolvedValue(null);
    const req = request({
      userContext: { userId: 'cognito-sub-1', identityId: 'cognito-sub-1' },
    });

    await expect(ensureCanonicalUserId(req, directory)).rejects.toBeInstanceOf(
      BaseError,
    );
  });

  it('rejects a request with no authentication context', async () => {
    await expect(ensureCanonicalUserId(request(), directory)).rejects.toThrow(
      'Unauthorized',
    );
  });
});
