import {
  LambdaRequest,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  VEHICLE_TYPE_VALUES,
} from '@api-hub/utils';

import { VehiclesService } from './vehicles.service';
import { VehiclesRepository } from '../repositories/vehicles.repository';
import { VehicleDdbItem } from '../types/repository.types';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  return {
    context: {
      userContext: { userId: 'user-1' },
    },
    params: {},
    body: {
      registrationNumber: 'kl 07 ab 1234',
      vehicleType: 'HATCHBACK',
    },
    ...overrides,
  } as unknown as LambdaRequest;
}

function stored(overrides: Partial<VehicleDdbItem> = {}): VehicleDdbItem {
  return {
    PK: 'USER#user-1',
    SK: 'VEHICLE#veh-1',
    vehicleId: 'veh-1',
    userId: 'user-1',
    registrationNumber: 'KL 07 AB 1234',
    vehicleType: 'HATCHBACK',
    status: 'ACTIVE',
    defaultVehicle: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    LSI1SK: 'STATUS#ACTIVE',
    LSI2SK: 'TYPE#HATCHBACK',
    LSI3SK: 'DEFAULT#1',
    entityType: 'Vehicle',
    ...overrides,
  };
}

describe('VehiclesService', () => {
  let repository: jest.Mocked<
    Pick<
      VehiclesRepository,
      | 'listVehicles'
      | 'listVehiclesByStatus'
      | 'listVehiclesByType'
      | 'createVehicle'
      | 'getVehicle'
      | 'updateVehicle'
      | 'updateVehicleWithDefaultRoll'
      | 'deleteVehicle'
      | 'deleteVehicleAndSetDefault'
      | 'getDefaultVehicle'
      | 'setDefaultVehicle'
    >
  >;
  let service: VehiclesService;

  beforeEach(() => {
    repository = {
      listVehicles: jest.fn().mockResolvedValue([]),
      listVehiclesByStatus: jest.fn().mockResolvedValue([]),
      listVehiclesByType: jest.fn().mockResolvedValue([]),
      createVehicle: jest.fn().mockResolvedValue(undefined),
      getVehicle: jest.fn(),
      updateVehicle: jest.fn().mockResolvedValue(undefined),
      updateVehicleWithDefaultRoll: jest.fn().mockResolvedValue(undefined),
      deleteVehicle: jest.fn().mockResolvedValue(undefined),
      deleteVehicleAndSetDefault: jest.fn().mockResolvedValue(undefined),
      getDefaultVehicle: jest.fn(),
      setDefaultVehicle: jest.fn().mockResolvedValue(undefined),
    };
    service = new VehiclesService(repository as unknown as VehiclesRepository);
  });

  it('lists only the authenticated customer vehicles', async () => {
    repository.listVehicles.mockResolvedValue([stored()]);

    const result = await service.getvehicles(
      request({
        body: { userId: 'user-2' },
        params: { userId: 'user-2' },
      }),
    );

    expect(repository.listVehicles).toHaveBeenCalledWith('user-1');
    expect(result).toEqual([
      expect.objectContaining({ id: 'veh-1', userId: 'user-1' }),
    ]);
  });

  it('applies the status filter from the gateway query params', async () => {
    await service.getvehicles(request({ params: { status: 'active' } }));

    expect(repository.listVehiclesByStatus).toHaveBeenCalledWith(
      'user-1',
      'ACTIVE',
    );
    expect(repository.listVehicles).not.toHaveBeenCalled();
  });

  it('creates a vehicle for the token user and makes the first one default', async () => {
    const created = await service.postvehicles(
      request({
        body: {
          userId: 'user-2',
          registrationNumber: 'kl07ab1234',
          vehicleType: 'SEDAN',
        },
      }),
    );

    expect(created.userId).toBe('user-1');
    expect(created.defaultVehicle).toBe(true);
    expect(created.vehicleType).toBe('SEDAN');
    expect(repository.createVehicle).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        registrationNumber: 'KL07AB1234',
        defaultVehicle: true,
      }),
    );
  });

  it('rejects a vehicle without a type', async () => {
    await expect(
      service.postvehicles(
        request({
          body: { registrationNumber: 'KL07AB1234' },
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.createVehicle).not.toHaveBeenCalled();
  });

  it('does not return another customer vehicle', async () => {
    repository.getVehicle.mockResolvedValue(null);

    await expect(
      service.getvehicleid(
        request({ pathParameters: { vehicleId: 'veh-other' } }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.getVehicle).toHaveBeenCalledWith('user-1', 'veh-other');
  });

  it('updates a vehicle owned by the caller', async () => {
    repository.getVehicle.mockResolvedValue(stored({ defaultVehicle: false }));

    const updated = await service.putvehicleid(
      request({
        pathParameters: { vehicleId: 'veh-1' },
        body: {
          registrationNumber: 'KL 01 AA 0001',
          vehicleType: 'SUV',
        },
      }),
    );

    expect(updated.vehicleType).toBe('SUV');
    expect(repository.updateVehicle).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', vehicleId: 'veh-1' }),
    );
  });

  it('deletes a vehicle and promotes another default', async () => {
    repository.getVehicle.mockResolvedValue(stored());
    repository.listVehicles.mockResolvedValue([
      stored(),
      stored({
        vehicleId: 'veh-2',
        SK: 'VEHICLE#veh-2',
        defaultVehicle: false,
        LSI3SK: 'DEFAULT#0',
      }),
    ]);

    await service.deletevehicleid(
      request({ pathParameters: { vehicleId: 'veh-1' } }),
    );

    expect(repository.deleteVehicleAndSetDefault).toHaveBeenCalledWith(
      'user-1',
      'veh-1',
      'veh-2',
      expect.any(String),
    );
  });

  it('rejects an unauthenticated list', async () => {
    await expect(
      service.getvehicles(
        request({ context: { userContext: {} } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('requires an authenticated caller for vehicle types', async () => {
    await expect(
      service.getvehicletypes(request({ context: { userContext: {} } })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns the canonical vehicle type list', async () => {
    const result = await service.getvehicletypes(request());

    expect(result).toEqual({ items: [...VEHICLE_TYPE_VALUES] });
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toEqual(
      expect.arrayContaining(['HATCHBACK', 'SEDAN', 'SUV', 'MUV', 'LUXURY', 'BIKE']),
    );
  });
});
