import {
  ConditionalWriteConflictError,
  ForbiddenError,
  LambdaRequest,
} from '@api-hub/utils';

import { EventSchemaError } from '@api-hub/middleware';

import { CustomersService } from './customers.service';
import { CustomersRepository } from '../repositories/customers.repository';
import { validateCustomerProfileUpdate } from '../schemas/customers.schema';
import { CustomerProfileRecord } from '../types/records';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  const context = {
    userContext: { userId: 'user-1', roles: ['customer'] },
    ...(overrides.context as object),
  };
  return {
    pathParameters: { userId: 'user-1' },
    params: { userId: 'user-1' },
    body: {},
    ...overrides,
    context,
  } as unknown as LambdaRequest;
}

function profile(overrides: Partial<CustomerProfileRecord> = {}): CustomerProfileRecord {
  return {
    PK: 'USER#user-1',
    SK: 'PROFILE',
    entityType: 'CustomerProfile',
    userId: 'user-1',
    status: 'active',
    communityIds: ['community-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CustomersService', () => {
  let repository: jest.Mocked<
    Pick<CustomersRepository, 'getProfile' | 'saveProfile' | 'getPhoneLookup'>
  >;
  let service: CustomersService;

  beforeEach(() => {
    repository = {
      getProfile: jest.fn().mockResolvedValue(profile()),
      saveProfile: jest.fn().mockResolvedValue(undefined),
      getPhoneLookup: jest.fn(),
    };
    service = new CustomersService(repository as unknown as CustomersRepository);
  });

  it('returns the profile to the owner without marketing consent', async () => {
    const result = await service.getCustomer(request());

    expect(result.userId).toBe('user-1');
    expect(result.communityIds).toEqual(['community-1']);
    expect(result).not.toHaveProperty('marketingConsent');
  });

  it('rejects another customer before reading', async () => {
    await expect(
      service.getCustomer(
        request({
          context: { userContext: { userId: 'user-2', roles: ['customer'] } },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.getProfile).not.toHaveBeenCalled();
  });

  it('lets a service principal read a profile', async () => {
    const result = await service.getCustomer(
      request({
        context: { userContext: { roles: ['service'] } },
      }),
    );
    expect(result.userId).toBe('user-1');
  });

  it('stores a normalized phone and keeps community membership', async () => {
    await service.putCustomer(
      request({
        body: {
          firstName: 'Asha',
          phone: '+14155552671',
          email: 'Asha@Example.com',
        },
      }),
    );

    expect(repository.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        firstName: 'Asha',
        phone: '+14155552671',
        email: 'asha@example.com',
        communityIds: ['community-1'],
      }),
      expect.objectContaining({ isCreate: false }),
    );
  });

  it('blocks a customer from changing status', async () => {
    await expect(
      service.putCustomer(request({ body: { status: 'suspended' } })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('maps a phone conditional failure to a conflict', async () => {
    repository.saveProfile.mockRejectedValue(
      new ConditionalWriteConflictError(new Error('conflict'), {
        failedTransactItemIndexes: [1],
      }),
    );

    await expect(
      service.putCustomer(
        request({
          context: { userContext: { userId: 'admin-1', roles: ['admin'] } },
          body: { phone: '+14155552671' },
        }),
      ),
    ).rejects.toThrow('Phone number is already in use');
  });

  it('rejects marketing consent on the profile contract', () => {
    expect(() =>
      validateCustomerProfileUpdate(
        request({ body: { marketingConsent: true } }) as LambdaRequest,
      ),
    ).toThrow(EventSchemaError);
  });
});
