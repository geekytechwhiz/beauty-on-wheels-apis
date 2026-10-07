import type { IdentityRepository } from '../repositories/identity.repository';
import type { User } from '../types/repository.types';
import { loadApplicationRolesForIdentity } from './access-token-roles';

function repository(
  user: User | null,
  assigned: string[] = [],
): IdentityRepository {
  return {
    getUserByIdentityId: jest.fn().mockResolvedValue(user),
    getUserRoles: jest.fn().mockResolvedValue(assigned),
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
