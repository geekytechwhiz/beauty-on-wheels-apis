import { env } from '../configs/env.config';
import { VehicleSnapshot } from '../domain/create-booking';
import { BookingError } from '../errors';
import { authHeaders, requestJson, requireBaseUrl } from './http';

export interface VehicleGateway {
  getVehicle(vehicleId: string, authorizationHeader?: string): Promise<VehicleSnapshot>;
}

export class HttpVehicleGateway implements VehicleGateway {
  async getVehicle(vehicleId: string, authorizationHeader?: string): Promise<VehicleSnapshot> {
    const base = requireBaseUrl(env.VEHICLE_SERVICE_URL, 'VEHICLE_SERVICE_URL');
    try {
      const body = await requestJson(
        `${base}/vehicles/${encodeURIComponent(vehicleId)}`,
        { method: 'GET', headers: authHeaders(authorizationHeader) },
      );
      return parseVehicle(body, vehicleId);
    } catch (error) {
      if (error instanceof BookingError && error.statusCode === 404) {
        throw new BookingError(
          'VEHICLE_NOT_OWNED',
          'Vehicle is not owned by the authenticated customer',
          403,
          'vehicleId',
          false,
        );
      }
      throw error;
    }
  }
}

function parseVehicle(body: unknown, vehicleId: string): VehicleSnapshot {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const vehicleType = record.vehicleType;
  if (typeof vehicleType !== 'string' || !vehicleType.trim()) {
    throw new BookingError('DEPENDENCY_UNAVAILABLE', 'Vehicle Service did not return a vehicle type', 502);
  }
  return {
    id: typeof record.id === 'string' ? record.id : vehicleId,
    ...(typeof record.userId === 'string' ? { userId: record.userId } : {}),
    vehicleType,
    ...(typeof record.brand === 'string' ? { brand: record.brand } : {}),
    ...(typeof record.model === 'string' ? { model: record.model } : {}),
  };
}

let gateway: VehicleGateway | undefined;

export function getVehicleGateway(): VehicleGateway {
  if (!gateway) {
    gateway = new HttpVehicleGateway();
  }
  return gateway;
}
