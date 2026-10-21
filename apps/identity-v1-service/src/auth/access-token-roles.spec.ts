import type { IdentityRepository } from '../repositories/identity.repository';
import type { Profile, User } from '../types/repository.types';
import {
  loadApplicationRolesForIdentity,
  loadApplicationTokenClaimsForIdentity,
} from './access-token-roles';

function repository(
  user: User | null,
  assigned: string[] = [],
  profile: Profile | null = null,
): IdentityRepository {
  return {
    getUserByIdentityId: jest.fn().mockResolvedValue(user),
    getUserRoles: jest.fn().mockResolvedValue(assigned),
    getProfile: jest.fn().mockResolvedValue(profile),
  } as unknown as IdentityRepository;
}

const baseUser: User = {
  userId: 'u-1',
  email: 'ada@example.com',
  username: 'ada@example.com',
  phoneNumber: '',
  passwordHash: 'hash',
  status: 'ACTIVE',
  emailVerified: true,
  phoneVerified: false,
  version: 1,
  identityId: 'cognito-sub-1',
  roleId: 'user',
};

describe('loadApplicationRolesForIdentity', () => {
  it('reads CUSTOMER and VENDOR from the role mapping, not the generic role', async () => {
    const repo = repository(
      { ...baseUser, roleId: 'user' },
      ['VENDOR', 'CUSTOMER'],
    );
    await expect(loadApplicationRolesForIdentity('cognito-sub-1', repo)).resolves.toEqual([
      'CUSTOMER',
      'VENDOR',
    ]);
    expect(repo.getUserRoles).toHaveBeenCalledWith('u-1');
  });

  it('reads an explicit role stored only on the user profile', async () => {
    const repo = repository({ ...baseUser, roleId: 'ADMIN' }, []);
    await expect(loadApplicationRolesForIdentity('cognito-sub-1', repo)).resolves.toEqual([
      'ADMIN',
    ]);
  });

  it('returns no application roles for a legacy user', async () => {
    const repo = repository(baseUser, ['user']);
    await expect(loadApplicationRolesForIdentity('cognito-sub-1', repo)).resolves.toEqual(
      [],
    );
  });

  it('returns no application roles when the identity is not linked yet', async () => {
    const repo = repository(null);
    await expect(loadApplicationRolesForIdentity('cognito-sub-1', repo)).resolves.toEqual(
      [],
    );
    expect(repo.getUserRoles).not.toHaveBeenCalled();
  });
});

describe('loadApplicationTokenClaimsForIdentity', () => {
  it('adds the linked application userId for an existing user', async () => {
    const repo = repository(baseUser, ['CUSTOMER'], {
      userId: 'u-1',
      firstName: '',
      lastName: '',
      identityId: 'cognito-sub-1',
      userProvisioning: { status: 'LINKED', userId: 'app-user' },
    });

    await expect(
      loadApplicationTokenClaimsForIdentity('cognito-sub-1', repo),
    ).resolves.toEqual({
      roles: ['CUSTOMER'],
      identityId: 'cognito-sub-1',
      userId: 'app-user',
      userType: 'CUSTOMER',
    });
    expect(repo.getProfile).toHaveBeenCalledWith('u-1');
  });

  it('omits userId while the application user is not provisioned', async () => {
    const repo = repository(
      { ...baseUser, userType: 'CUSTOMER' },
      ['CUSTOMER'],
      {
        userId: 'u-1',
        firstName: '',
        lastName: '',
        userProvisioning: { status: 'PENDING' },
      },
    );

    const claims = await loadApplicationTokenClaimsForIdentity('cognito-sub-1', repo);
    expect(claims.userId).toBeUndefined();
    expect(claims.identityId).toBe('cognito-sub-1');
    expect(claims.roles).toEqual(['CUSTOMER']);
    expect(claims.userType).toBe('CUSTOMER');
  });

  it('does not use the identity user id or Cognito sub when the link is missing', async () => {
    const repo = repository(baseUser, [], {
      userId: 'u-1',
      firstName: '',
      lastName: '',
      userProvisioning: { status: 'FAILED', userId: 'cognito-sub-1' },
    });

    const claims = await loadApplicationTokenClaimsForIdentity('cognito-sub-1', repo);
    expect(claims.userId).toBeUndefined();
    expect(JSON.stringify(claims)).not.toContain('u-1');
  });

  it('returns no userId when the identity does not exist yet', async () => {
    const repo = repository(null);
    await expect(
      loadApplicationTokenClaimsForIdentity('cognito-sub-1', repo),
    ).resolves.toEqual({ roles: [] });
    expect(repo.getProfile).not.toHaveBeenCalled();
  });

  it('lets a user lookup failure propagate', async () => {
    const repo = repository(baseUser);
    (repo.getProfile as jest.Mock).mockRejectedValue(new Error('dynamo unavailable'));
    await expect(
      loadApplicationTokenClaimsForIdentity('cognito-sub-1', repo),
    ).rejects.toThrow('dynamo unavailable');
  });
});
