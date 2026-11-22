import {
  CreateStaffRequest,
  Staff,
  StaffStatus,
  UpdateStaffRequest,
} from '../types/api-types';
import { StaffDdbItem } from '../types/repository.types';
import {
  STAFF_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

const DEFAULT_STATUS: StaffStatus = 'ACTIVE';

export class StaffMapper {
  static toDomain(item: StaffDdbItem): Staff {
    return {
      staffId: item.staffId,
      vendorId: item.vendorId,
      userId: item.userId,
      name: item.name,
      phoneNumber: item.phoneNumber,
      email: item.email,
      role: item.role,
      status: item.status,
      provisioningStatus: item.provisioningStatus,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toDdbItem(
    request: CreateStaffRequest,
    vendorId: string,
    staffId: string,
    options?: { createdAt?: string },
  ): StaffDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.staffSk(staffId),
      staffId,
      vendorId,
      name: request.name,
      phoneNumber: request.phoneNumber,
      role: 'BUDDY',
      status: request.status ?? DEFAULT_STATUS,
      provisioningStatus: 'PENDING',
      createdAt,
      updatedAt: timestamp,
      entityType: STAFF_ENTITY_TYPE,
    };
  }

  static applyUpdate(
    existing: StaffDdbItem,
    updates: UpdateStaffRequest,
  ): StaffDdbItem {
    return {
      ...existing,
      name: updates.name ?? existing.name,
      updatedAt: new Date().toISOString(),
    };
  }

  static applyDeactivate(existing: StaffDdbItem): StaffDdbItem {
    return {
      ...existing,
      status: 'INACTIVE',
      updatedAt: new Date().toISOString(),
    };
  }
}
