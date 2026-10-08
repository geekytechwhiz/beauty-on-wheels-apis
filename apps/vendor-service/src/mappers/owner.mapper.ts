import { VendorOwner } from '../types/api-types';
import {
  VendorOwnerDdbItem,
  VendorOwnershipDdbItem,
} from '../types/repository.types';
import {
  VENDOR_OWNER_ENTITY_TYPE,
  VENDOR_OWNERSHIP_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export class OwnerMapper {
  static toDomain(item: VendorOwnerDdbItem): VendorOwner {
    return {
      vendorId: item.vendorId,
      userId: item.userId,
      fullName: item.fullName,
      designation: item.designation,
      phoneNumber: item.phoneNumber,
      email: item.email,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toDdbItem(
    vendorId: string,
    data: {
      userId: string;
      fullName?: string;
      designation?: string;
      phoneNumber?: string;
      email?: string;
    },
    options?: { createdAt?: string },
  ): VendorOwnerDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.ownerSk(),
      vendorId,
      userId: data.userId,
      fullName: data.fullName,
      designation: data.designation,
      phoneNumber: data.phoneNumber,
      email: data.email,
      createdAt,
      updatedAt: timestamp,
      GSI1PK: VendorKeyBuilder.ownerGsi1Pk(data.userId),
      GSI1SK: VendorKeyBuilder.ownerGsi1Sk(vendorId),
      entityType: VENDOR_OWNER_ENTITY_TYPE,
    };
  }

  static initialOwner(vendorId: string, userId: string): VendorOwnerDdbItem {
    return OwnerMapper.toDdbItem(vendorId, { userId });
  }

  /**
   * Uniqueness item keyed by the application user. GSI attributes are omitted so
   * owner lookup stays on the VendorOwner item's existing GSI1 keys.
   */
  static ownershipClaim(
    vendorId: string,
    userId: string,
    options?: { createdAt?: string },
  ): VendorOwnershipDdbItem {
    const timestamp = new Date().toISOString();
    return {
      PK: VendorKeyBuilder.ownershipPk(userId),
      SK: VendorKeyBuilder.ownershipSk(),
      vendorId,
      ownerUserId: userId,
      createdAt: options?.createdAt ?? timestamp,
      updatedAt: timestamp,
      entityType: VENDOR_OWNERSHIP_ENTITY_TYPE,
    };
  }
}
