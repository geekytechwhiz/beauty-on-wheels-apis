import { Vehicle } from "../types/api-types";
import { VehicleDdbItem } from "../types/repository.types";

export class VehiclesMapper {
  static normalizeRegistrationNumber(reg: string): string {
    return reg.trim().toUpperCase().replace(/\s+/g, ' ');
  }

  static toDomain(item: VehicleDdbItem): Vehicle {
    return {
      id: item.vehicleId,
      userId: item.userId,
      registrationNumber: item.registrationNumber,
      vehicleType: item.vehicleType,
      brand: item.brand,
      model: item.model,
      variant: item.variant,
      color: item.color,
      fuelType: item.fuelType,
      manufactureYear: item.manufactureYear,
      defaultVehicle: item.defaultVehicle,
    };
  }

  static toDdbItem(
    vehicle: Vehicle,
    userId: string,
    vehicleId: string,
    options: {
      defaultVehicle: boolean;
      createdAt?: string;
      status?: 'ACTIVE' | 'INACTIVE';
    }
  ): VehicleDdbItem {
    const timestamp = new Date().toISOString();
    const status = options.status || 'ACTIVE';
    const defaultVehicle = options.defaultVehicle;

    return {
      PK: `USER#${userId}`,
      SK: `VEHICLE#${vehicleId}`,
      vehicleId,
      userId,
      registrationNumber: this.normalizeRegistrationNumber(vehicle.registrationNumber),
      vehicleType: vehicle.vehicleType,
      brand: vehicle.brand,
      model: vehicle.model,
      variant: vehicle.variant,
      fuelType: vehicle.fuelType,
      manufactureYear: vehicle.manufactureYear,
      color: vehicle.color,
      status,
      defaultVehicle,
      createdAt: options.createdAt || timestamp,
      updatedAt: timestamp,
      LSI1SK: `STATUS#${status}`,
      LSI2SK: `TYPE#${vehicle.vehicleType}`,
      LSI3SK: `DEFAULT#${defaultVehicle ? '1' : '0'}`,
      entityType: 'Vehicle',
    };
  }
}
