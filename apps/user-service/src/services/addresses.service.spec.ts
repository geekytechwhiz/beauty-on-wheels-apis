import { ForbiddenError, LambdaRequest } from '@api-hub/utils';

import { AddressesService } from './addresses.service';
import { AddressesRepository } from '../repositories/addresses.repository';
import { CustomersRepository } from '../repositories/customers.repository';
import { AddressRecord, CustomerProfileRecord } from '../types/records';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  const context = {
    userContext: { userId: 'user-1', roles: ['customer'] },
    ...(overrides.context as object),
  };
  return {
    pathParameters: {
      userId: 'user-1',
      ...(overrides.pathParameters as object),
    },
    params: { userId: 'user-1', ...(overrides.params as object) },
    body: {
      line1: '12 Palm Street',
      city: 'Kochi',
      ...(overrides.body as object),
    },
    ...overrides,
    context,
  } as unknown as LambdaRequest;
}

function profile(): CustomerProfileRecord {
  return {
    PK: 'USER#user-1',
    SK: 'PROFILE',
    entityType: 'CustomerProfile',
    userId: 'user-1',
    status: 'active',
    communityIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function address(id: string, isDefault: boolean): AddressRecord {
  return {
    PK: 'USER#user-1',
    SK: `ADDR#${id}`,
    entityType: 'Address',
    addressId: id,
    userId: 'user-1',
    type: 'home',
    line1: '12 Palm Street',
    city: 'Kochi',
    isDefault,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('AddressesService', () => {
  let addresses: jest.Mocked<
    Pick<AddressesRepository, 'listByUser' | 'getAddress' | 'writeAddress'>
  >;
  let customers: jest.Mocked<Pick<CustomersRepository, 'getProfile'>>;
  let service: AddressesService;

  beforeEach(() => {
    addresses = {
      listByUser: jest.fn().mockResolvedValue([]),
      getAddress: jest.fn(),
      writeAddress: jest.fn().mockResolvedValue(undefined),
    };
    customers = {
      getProfile: jest.fn().mockResolvedValue(profile()),
    };
    service = new AddressesService(
      addresses as unknown as AddressesRepository,
      customers as unknown as CustomersRepository,
    );
  });

  it('makes the first address the default', async () => {
    const created = await service.createAddress(request());

    expect(created.isDefault).toBe(true);
    expect(addresses.writeAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        expectExisting: false,
        profileUpdate: expect.objectContaining({
          defaultAddressId: created.id,
        }),
      }),
    );
  });

  it('clears the previous default when a new default is saved', async () => {
    addresses.listByUser.mockResolvedValue([address('addr-1', true)]);
    customers.getProfile.mockResolvedValue({
      ...profile(),
      defaultAddressId: 'addr-1',
    });

    await service.createAddress(request({ body: { isDefault: true } }));

    expect(addresses.writeAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        clearAddress: expect.objectContaining({
          addressId: 'addr-1',
          isDefault: false,
        }),
      }),
    );
  });

  it('promotes another address when the default is deleted', async () => {
    addresses.listByUser.mockResolvedValue([
      address('addr-1', true),
      address('addr-2', false),
    ]);
    addresses.getAddress.mockResolvedValue(address('addr-1', true));
    customers.getProfile.mockResolvedValue({
      ...profile(),
      defaultAddressId: 'addr-1',
    });

    await service.deleteAddress(
      request({ pathParameters: { addressId: 'addr-1' } }),
    );

    expect(addresses.writeAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        address: expect.objectContaining({
          addressId: 'addr-1',
          status: 'deleted',
        }),
        promoteAddress: expect.objectContaining({
          addressId: 'addr-2',
          isDefault: true,
        }),
        profileUpdate: expect.objectContaining({
          defaultAddressId: 'addr-2',
        }),
      }),
    );
  });

  it('rejects another customer', async () => {
    await expect(
      service.listAddresses(
        request({
          context: { userContext: { userId: 'user-2', roles: ['customer'] } },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(customers.getProfile).not.toHaveBeenCalled();
  });
});
