import { ForbiddenError, LambdaRequest, NotFoundError, ValidationError } from '@api-hub/utils';

import { UsersService } from './users.service';
import { CustomersRepository } from '../repositories/customers.repository';
import { CustomerProfileRecord, PhoneLookupRecord } from '../types/records';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  const context = {
    userContext: { userId: 'user-1', roles: ['customer'] },
    ...(overrides.context as object),
  };
  return {
    pathParameters: { userId: 'user-1' },
    params: { userId: 'user-1', ...(overrides.params as object) },
    ...overrides,
    context,
  } as unknown as LambdaRequest;
}

describe('UsersService phone lookup', () => {
  let customers: jest.Mocked<
    Pick<CustomersRepository, 'getPhoneLookup' | 'getProfile'>
  >;
  let service: UsersService;

  const lookup: PhoneLookupRecord = {
    PK: 'PHONE#+14155552671',
    SK: 'LOOKUP',
    entityType: 'PhoneLookup',
    userId: 'user-1',
    phone: '+14155552671',
    status: 'active',
  };

  beforeEach(() => {
    customers = {
      getPhoneLookup: jest.fn().mockResolvedValue(lookup),
      getProfile: jest.fn().mockResolvedValue({
        userId: 'user-1',
        status: 'active',
        phone: '+14155552671',
        communityIds: [],
      } as CustomerProfileRecord),
    };
    service = new UsersService(customers as unknown as CustomersRepository);
  });

  it('returns id, phone, and status for a service principal', async () => {
    const result = await service.lookupByPhone(
      request({
        params: { phone: '+14155552671' },
        context: { userContext: { roles: ['whatsapp'] } },
      }),
    );

    expect(result).toEqual({
      id: 'user-1',
      phone: '+14155552671',
      status: 'active',
    });
  });

  it('rejects a customer lookup', async () => {
    await expect(
      service.lookupByPhone(request({ params: { phone: '+14155552671' } })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(customers.getPhoneLookup).not.toHaveBeenCalled();
  });

  it('requires a phone query', async () => {
    await expect(
      service.lookupByPhone(
        request({
          params: {},
          context: { userContext: { roles: ['admin'], userId: 'admin-1' } },
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns not found when the phone is unknown', async () => {
    customers.getPhoneLookup.mockResolvedValue(null);
    await expect(
      service.lookupByPhone(
        request({
          params: { phone: '+14155552671' },
          context: { userContext: { roles: ['service'] } },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
