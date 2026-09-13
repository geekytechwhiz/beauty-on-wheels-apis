import {
  UpdateVendorCapabilitiesRequest,
  VendorCapabilities,
} from '../types/api-types';
import { VendorCapabilitiesDdbItem } from '../types/repository.types';
import {
  VENDOR_CAPABILITIES_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export class CapabilitiesMapper {
  static toDomain(item: VendorCapabilitiesDdbItem): VendorCapabilities {
    return {
      vendorId: item.vendorId,
      vehicleTypes: item.vehicleTypes,
      serviceIds: item.serviceIds,
      packageIds: item.packageIds,
      updatedAt: item.updatedAt,
    };
  }

  static empty(vendorId: string): VendorCapabilities {
    return {
      vendorId,
      vehicleTypes: [],
      serviceIds: [],
      packageIds: [],
    };
  }

  static toDdbItem(
    request: UpdateVendorCapabilitiesRequest,
    vendorId: string,
    options?: { createdAt?: string },
  ): VendorCapabilitiesDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.capabilitiesSk(),
      vendorId,
      vehicleTypes: [...new Set(request.vehicleTypes)],
      serviceIds: [...new Set(request.serviceIds)],
      packageIds: [...new Set(request.packageIds)],
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_CAPABILITIES_ENTITY_TYPE,
    };
  }
}
