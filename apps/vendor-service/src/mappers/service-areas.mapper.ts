import {
  CreateServiceAreaRequest,
  ServiceArea,
  UpdateServiceAreaRequest,
} from '../types/api-types';
import { ServiceAreaDdbItem } from '../types/repository.types';
import {
  SERVICE_AREA_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export class ServiceAreasMapper {
  static toDomain(item: ServiceAreaDdbItem): ServiceArea {
    return {
      serviceAreaId: item.serviceAreaId,
      vendorId: item.vendorId,
      name: item.name,
      city: item.city,
      state: item.state,
      postalCodes: item.postalCodes,
      center: item.center,
      radiusKm: item.radiusKm,
      active: item.active,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toDdbItem(
    request: CreateServiceAreaRequest,
    vendorId: string,
    serviceAreaId: string,
    options?: { createdAt?: string },
  ): ServiceAreaDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.serviceAreaSk(serviceAreaId),
      serviceAreaId,
      vendorId,
      name: request.name,
      city: request.city,
      state: request.state,
      postalCodes: request.postalCodes,
      center: request.center,
      radiusKm: request.radiusKm,
      active: request.active ?? true,
      createdAt,
      updatedAt: timestamp,
      entityType: SERVICE_AREA_ENTITY_TYPE,
    };
  }

  static applyUpdate(
    existing: ServiceAreaDdbItem,
    updates: UpdateServiceAreaRequest,
  ): ServiceAreaDdbItem {
    return {
      ...existing,
      name: updates.name ?? existing.name,
      city: updates.city ?? existing.city,
      state: updates.state !== undefined ? updates.state : existing.state,
      postalCodes:
        updates.postalCodes !== undefined
          ? updates.postalCodes
          : existing.postalCodes,
      center: updates.center !== undefined ? updates.center : existing.center,
      radiusKm:
        updates.radiusKm !== undefined ? updates.radiusKm : existing.radiusKm,
      active: updates.active !== undefined ? updates.active : existing.active,
      updatedAt: new Date().toISOString(),
    };
  }
}
