import { ConditionalWriteConflictError } from '@api-hub/utils';

import { CustomersRepository } from '../repositories/customers.repository';
import { IdentityProvisioningService } from './identity-provisioning.service';

describe('IdentityProvisioningService', () => {
  const repository = () => ({
    getIdentityLookup: jest.fn(),
    createProvisionedUser: jest.fn(),
  });

  it('creates a minimal user and identity lookup together', async () => {
    const repo = repository();
    repo.getIdentityLookup.mockResolvedValue(null);
    const result = await new IdentityProvisioningService(repo as unknown as CustomersRepository).ensureUserForIdentity({ identityId: 'identity-1', userId: 'u-1', phone: '+919999999999' });
    expect(result.created).toBe(true);
    expect(repo.createProvisionedUser).toHaveBeenCalledWith(expect.objectContaining({ userId: result.userId, phone: '+919999999999' }), 'identity-1');
  });

  it('reuses the existing mapping without overwriting the profile', async () => {
    const repo = repository();
    repo.getIdentityLookup.mockResolvedValue({ userId: 'u-existing' });
    await expect(new IdentityProvisioningService(repo as unknown as CustomersRepository).ensureUserForIdentity({ identityId: 'identity-1', userId: 'u-1' }))
      .resolves.toEqual({ identityId: 'identity-1', userId: 'u-existing', created: false });
    expect(repo.createProvisionedUser).not.toHaveBeenCalled();
  });

  it('resolves the winning mapping after a concurrent conditional write', async () => {
    const repo = repository();
    repo.getIdentityLookup
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'u-winner' });
    repo.createProvisionedUser.mockRejectedValue(new ConditionalWriteConflictError(new Error('conditional')));
    await expect(new IdentityProvisioningService(repo as unknown as CustomersRepository).ensureUserForIdentity({ identityId: 'identity-1', userId: 'u-1' }))
      .resolves.toEqual({ identityId: 'identity-1', userId: 'u-winner', created: false });
  });
});
