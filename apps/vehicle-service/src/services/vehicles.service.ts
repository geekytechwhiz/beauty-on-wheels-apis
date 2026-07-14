import { LambdaRequest } from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';
import { randomUUID } from 'crypto';

import {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
} from '@api-hub/utils';

import {
  VehiclesRepository,
  getVehiclesRepository,
} from '../repositories/vehicles.repository';
import { VehiclesMapper } from '../mappers/vehicles.mapper';
import { Vehicle } from '../types/api-types';
import { VehicleDdbItem } from '../types/repository.types';

const baseLogger = createLogger({
  service: 'vehicles-service',
  redactPII: true,
});

const VALID_VEHICLE_TYPES = [
  'HATCHBACK',
  'SEDAN',
  'SUV',
  'MUV',
  'LUXURY',
  'BIKE',
];
const VALID_FUEL_TYPES = ['PETROL', 'DIESEL', 'EV', 'HYBRID', 'CNG'];

export class VehiclesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'VehiclesService',
  });

  constructor(
    private readonly repository: VehiclesRepository = getVehiclesRepository(),
  ) {}

  private getAuthenticatedUserId(request: LambdaRequest): string {
    const userId = request.context.userContext?.userId;
    if (!userId) {
      throw new UnauthorizedError('User is not authenticated');
    }
    return userId;
  }

  private validateVehicleFields(body: Partial<Vehicle>): void {
    // Validate vehicleType
    if (!body.vehicleType) {
      throw new ValidationError('vehicleType is required');
    }
    if (!VALID_VEHICLE_TYPES.includes(body.vehicleType)) {
      throw new ValidationError(
        `Invalid vehicleType. Supported types: ${VALID_VEHICLE_TYPES.join(', ')}`,
      );
    }

    // Validate fuelType if provided
    if (body.fuelType && !VALID_FUEL_TYPES.includes(body.fuelType)) {
      throw new ValidationError(
        `Invalid fuelType. Supported types: ${VALID_FUEL_TYPES.join(', ')}`,
      );
    }

    // Validate registrationNumber
    if (
      !body.registrationNumber ||
      body.registrationNumber.trim().length === 0
    ) {
      throw new ValidationError('Registration number cannot be blank');
    }

    // Validate manufactureYear
    if (body.manufactureYear !== undefined) {
      if (!Number.isInteger(body.manufactureYear)) {
        throw new ValidationError('Manufacture year must be an integer');
      }
      const currentYear = new Date().getFullYear();
      if (body.manufactureYear > currentYear) {
        throw new ValidationError('Manufacture year cannot be in the future');
      }
    }
  }

  async getvehicles(request: LambdaRequest): Promise<Vehicle[]> {
    const userId = this.getAuthenticatedUserId(request);
    const status = request.query?.status;
    const vehicleType = request.query?.vehicleType;

    this.logger.info({
      event: 'getvehicles_start',
      userId,
      status,
      vehicleType,
    });

    try {
      let items: VehicleDdbItem[];

      if (status) {
        const upperStatus = status.toUpperCase();
        if (upperStatus !== 'ACTIVE' && upperStatus !== 'INACTIVE') {
          throw new ValidationError(
            'Status query parameter must be ACTIVE or INACTIVE',
          );
        }
        items = await this.repository.listVehiclesByStatus(userId, upperStatus);
      } else if (vehicleType) {
        const upperType = vehicleType.toUpperCase();
        if (!VALID_VEHICLE_TYPES.includes(upperType)) {
          throw new ValidationError(
            `Invalid vehicleType query parameter. Supported: ${VALID_VEHICLE_TYPES.join(', ')}`,
          );
        }
        items = await this.repository.listVehiclesByType(userId, upperType);
      } else {
        items = await this.repository.listVehicles(userId);
      }

      this.logger.info({
        event: 'getvehicles_success',
        userId,
        count: items.length,
      });

      return items.map((item) => VehiclesMapper.toDomain(item));
    } catch (error: any) {
      this.logger.error({
        event: 'getvehicles_failed',
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  async postvehicles(request: LambdaRequest): Promise<Vehicle> {
    const userId = this.getAuthenticatedUserId(request);
    const body = request.body as Vehicle;

    this.logger.info({
      event: 'postvehicles_start',
      userId,
    });

    try {
      this.validateVehicleFields(body);

      // Fetch user's existing vehicles to determine default vehicle status
      const existingVehicles = await this.repository.listVehicles(userId);
      const isFirstVehicle = existingVehicles.length === 0;

      const vehicleId = randomUUID();
      const ddbItem = VehiclesMapper.toDdbItem(body, userId, vehicleId, {
        defaultVehicle: isFirstVehicle,
        status: 'ACTIVE',
      });

      await this.repository.createVehicle(ddbItem);

      this.logger.info({
        event: 'postvehicles_success',
        userId,
        vehicleId,
        defaultVehicle: isFirstVehicle,
      });

      return VehiclesMapper.toDomain(ddbItem);
    } catch (error: any) {
      this.logger.error({
        event: 'postvehicles_failed',
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  async getvehicleid(request: LambdaRequest): Promise<Vehicle> {
    const userId = this.getAuthenticatedUserId(request);
    const vehicleId = request.pathParameters?.vehicleId;

    if (!vehicleId) {
      throw new ValidationError('vehicleId is required');
    }

    this.logger.info({
      event: 'getvehicleid_start',
      userId,
      vehicleId,
    });

    try {
      const item = await this.repository.getVehicle(userId, vehicleId);
      if (!item) {
        throw new NotFoundError(`Vehicle with ID ${vehicleId} not found`);
      }

      this.logger.info({
        event: 'getvehicleid_success',
        userId,
        vehicleId,
      });

      return VehiclesMapper.toDomain(item);
    } catch (error: any) {
      this.logger.error({
        event: 'getvehicleid_failed',
        userId,
        vehicleId,
        error: error.message,
      });
      throw error;
    }
  }

  async putvehicleid(request: LambdaRequest): Promise<Vehicle> {
    const userId = this.getAuthenticatedUserId(request);
    const vehicleId = request.pathParameters?.vehicleId;
    const body = request.body as Vehicle;

    if (!vehicleId) {
      throw new ValidationError('vehicleId is required');
    }

    this.logger.info({
      event: 'putvehicleid_start',
      userId,
      vehicleId,
    });

    try {
      this.validateVehicleFields(body);

      // Fetch current state
      const currentItem = await this.repository.getVehicle(userId, vehicleId);
      if (!currentItem) {
        throw new NotFoundError(`Vehicle with ID ${vehicleId} not found`);
      }

      let defaultVehicle = currentItem.defaultVehicle;
      const wantSetDefault = body.defaultVehicle === true;

      let updatedItem: VehicleDdbItem;

      if (wantSetDefault && !defaultVehicle) {
        // Changing default status to true: demote the previous default atomically
        const currentDefault = await this.repository.getDefaultVehicle(userId);
        defaultVehicle = true;

        updatedItem = VehiclesMapper.toDdbItem(body, userId, vehicleId, {
          defaultVehicle,
          createdAt: currentItem.createdAt,
          status: currentItem.status,
        });

        if (currentDefault && currentDefault.vehicleId !== vehicleId) {
          await this.repository.updateVehicleWithDefaultRoll(
            updatedItem,
            currentDefault.vehicleId,
          );
          this.logger.info({
            event: 'default_vehicle_changed',
            userId,
            oldDefaultId: currentDefault.vehicleId,
            newDefaultId: vehicleId,
          });
        } else {
          await this.repository.updateVehicle(updatedItem);
        }
      } else {
        // Keep the current default vehicle status unchanged
        updatedItem = VehiclesMapper.toDdbItem(body, userId, vehicleId, {
          defaultVehicle,
          createdAt: currentItem.createdAt,
          status: currentItem.status,
        });
        await this.repository.updateVehicle(updatedItem);
      }

      this.logger.info({
        event: 'putvehicleid_success',
        userId,
        vehicleId,
      });

      return VehiclesMapper.toDomain(updatedItem);
    } catch (error: any) {
      this.logger.error({
        event: 'putvehicleid_failed',
        userId,
        vehicleId,
        error: error.message,
      });
      throw error;
    }
  }

  async deletevehicleid(request: LambdaRequest): Promise<void> {
    const userId = this.getAuthenticatedUserId(request);
    const vehicleId = request.pathParameters?.vehicleId;

    if (!vehicleId) {
      throw new ValidationError('vehicleId is required');
    }

    this.logger.info({
      event: 'deletevehicleid_start',
      userId,
      vehicleId,
    });

    try {
      const currentItem = await this.repository.getVehicle(userId, vehicleId);
      if (!currentItem) {
        throw new NotFoundError(`Vehicle with ID ${vehicleId} not found`);
      }

      if (currentItem.defaultVehicle) {
        // If it is the default vehicle, check if another vehicle exists to transfer default status to
        const allVehicles = await this.repository.listVehicles(userId);
        const otherVehicles = allVehicles.filter(
          (v) => v.vehicleId !== vehicleId,
        );

        if (otherVehicles.length > 0) {
          const newDefault = otherVehicles[0];
          await this.repository.deleteVehicleAndSetDefault(
            userId,
            vehicleId,
            newDefault.vehicleId,
            new Date().toISOString(),
          );
          this.logger.info({
            event: 'delete_default_vehicle_success',
            userId,
            deletedVehicleId: vehicleId,
            newDefaultVehicleId: newDefault.vehicleId,
          });
        } else {
          // Only vehicle, delete normally
          await this.repository.deleteVehicle(userId, vehicleId);
          this.logger.info({
            event: 'delete_only_vehicle_success',
            userId,
            deletedVehicleId: vehicleId,
          });
        }
      } else {
        // Not default, delete normally
        await this.repository.deleteVehicle(userId, vehicleId);
        this.logger.info({
          event: 'delete_non_default_vehicle_success',
          userId,
          deletedVehicleId: vehicleId,
        });
      }
    } catch (error: any) {
      this.logger.error({
        event: 'deletevehicleid_failed',
        userId,
        vehicleId,
        error: error.message,
      });
      throw error;
    }
  }

  async putdefault(request: LambdaRequest): Promise<{ message: string }> {
    const userId = this.getAuthenticatedUserId(request);
    const vehicleId = request.pathParameters?.vehicleId;

    if (!vehicleId) {
      throw new ValidationError('vehicleId is required');
    }

    this.logger.info({
      event: 'putdefault_start',
      userId,
      vehicleId,
    });

    try {
      const targetVehicle = await this.repository.getVehicle(userId, vehicleId);
      if (!targetVehicle) {
        throw new NotFoundError(`Vehicle with ID ${vehicleId} not found`);
      }

      if (targetVehicle.defaultVehicle) {
        this.logger.info({
          event: 'putdefault_already_default',
          userId,
          vehicleId,
        });
        return { message: 'Vehicle is already default' };
      }

      const currentDefault = await this.repository.getDefaultVehicle(userId);
      const currentDefaultId = currentDefault ? currentDefault.vehicleId : null;

      await this.repository.setDefaultVehicle(
        userId,
        currentDefaultId,
        vehicleId,
        new Date().toISOString(),
      );

      this.logger.info({
        event: 'putdefault_success',
        userId,
        oldDefaultId: currentDefaultId,
        newDefaultId: vehicleId,
      });

      return { message: 'Default vehicle updated successfully' };
    } catch (error: any) {
      this.logger.error({
        event: 'putdefault_failed',
        userId,
        vehicleId,
        error: error.message,
      });
      throw error;
    }
  }

  async getvehicletypes(request: LambdaRequest): Promise<string[]> {
    this.logger.info({
      event: 'getvehicletypes',
    });
    return VALID_VEHICLE_TYPES;
  }
}

let service: VehiclesService;

export function getVehiclesService() {
  if (!service) {
    service = new VehiclesService();
  }
  return service;
}
