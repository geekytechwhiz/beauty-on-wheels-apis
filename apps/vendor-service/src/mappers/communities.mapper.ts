import { OperationalStatus, VendorStatus } from '../types/api-types';
import {
  VendorCommunityDdbItem,
  VendorDdbItem,
} from '../types/repository.types';
import {
  VENDOR_COMMUNITY_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export class CommunitiesMapper {
  static toItem(input: {
    vendor: VendorDdbItem;
    communityId: string;
    assignedBy: string;
    assignedAt: string;
  }): VendorCommunityDdbItem {
    return {
      PK: VendorKeyBuilder.vendorPk(input.vendor.vendorId),
      SK: VendorKeyBuilder.communitySk(input.communityId),
      vendorId: input.vendor.vendorId,
      communityId: input.communityId,
      assignedBy: input.assignedBy,
      assignedAt: input.assignedAt,
      status: input.vendor.status,
      operationalStatus: input.vendor.operationalStatus,
      createdAt: input.assignedAt,
      updatedAt: input.assignedAt,
      GSI3PK: VendorKeyBuilder.communityGsi3Pk(input.communityId),
      GSI3SK: VendorKeyBuilder.communityGsi3Sk(
        input.vendor.status,
        input.vendor.vendorId,
      ),
      entityType: VENDOR_COMMUNITY_ENTITY_TYPE,
    };
  }

  static withVendorState(
    item: VendorCommunityDdbItem,
    vendor: Pick<VendorDdbItem, 'status' | 'operationalStatus' | 'vendorId'>,
    updatedAt: string,
  ): VendorCommunityDdbItem {
    return {
      ...item,
      status: vendor.status,
      operationalStatus: vendor.operationalStatus,
      updatedAt,
      GSI3SK: VendorKeyBuilder.communityGsi3Sk(vendor.status, vendor.vendorId),
    };
  }

  static toDomain(item: VendorCommunityDdbItem) {
    return {
      vendorId: item.vendorId,
      communityId: item.communityId,
      assignedBy: item.assignedBy,
      assignedAt: item.assignedAt,
      status: item.status as VendorStatus,
      operationalStatus: item.operationalStatus as OperationalStatus,
    };
  }
}
