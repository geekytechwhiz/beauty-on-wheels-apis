import {
  Address,
  OnboardingSection,
  OnboardingStatus,
  OperationalStatus,
  UpdateVendorRequest,
  Vendor,
  VendorAddress,
  VendorStatus,
  VendorStatusReview,
   businessType,
} from '../types/api-types';
import {
  VendorAddressDdbItem,
  VendorDdbItem,
  VendorStatusHistoryDdbItem,
  VendorStatusReviewRecord,
} from '../types/repository.types';
import {
  computeOnboardingState,
  isBusinessInfoComplete,
} from '../domain/onboarding';
import {
  VENDOR_ADDRESS_ENTITY_TYPE,
  VENDOR_ENTITY_TYPE,
  VENDOR_STATUS_HISTORY_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

const DEFAULT_STATUS: VendorStatus = 'PENDING_VERIFICATION';
const DEFAULT_OPERATIONAL_STATUS: OperationalStatus = 'OFFLINE';

export class VendorsMapper {
  static toDomain(
    item: VendorDdbItem,
    address?: VendorAddressDdbItem | VendorAddress | null,
  ): Vendor {
    const resolvedAddress = address
      ? VendorsMapper.toAddress(address)
      : undefined;

    return {
      vendorId: item.vendorId,
      ownerUserId: item.ownerUserId,
      createdBy: item.createdBy,
       businessType: item. businessType,
      businessName: item.businessName,
      contactName: item.contactName,
      phoneNumber: item.phoneNumber,
      loginPhoneNumber: item.loginPhoneNumber,
      identityId: item.identityId,
      accountProvisioningStatus: item.accountProvisioningStatus,
      accountProvisionedAt: item.accountProvisionedAt,
      email: item.email,
      description: item.description,
      profileImageUrl: item.profileImageUrl,
      gstNumber: item.gstNumber,
      panNumber: item.panNumber,
      address: resolvedAddress,
      geoLocation: address && 'geoLocation' in address ? address.geoLocation : undefined,
      status: item.status,
      operationalStatus: item.operationalStatus,
      onboardingStatus: item.onboardingStatus,
      currentSection: item.currentSection,
      completedSections: item.completedSections,
      applicationId: item.applicationId,
      revision: item.revision ?? 0,
      detailsAcceptedRevision: item.detailsAcceptedRevision,
      detailsAcceptedAt: item.detailsAcceptedAt,
      communityIds: item.communityIds ?? [],
      latestReview: item.latestReview
        ? VendorsMapper.toReview(item.latestReview)
        : undefined,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toAddress(
    item: VendorAddressDdbItem | VendorAddress | Address,
  ): Address {
    return {
      addressLine1: item.addressLine1,
      addressLine2: item.addressLine2,
      landmark: item.landmark,
      locality: 'locality' in item ? item.locality : undefined,
      city: item.city,
      district: 'district' in item ? item.district : undefined,
      state: item.state,
      country: item.country,
      postalCode: item.postalCode,
    };
  }

  static toInitialDdbItem(input: {
    vendorId: string;
    createdBy: string;
     businessType?:  businessType;
    businessName?: string;
    contactName?: string;
    phoneNumber?: string;
    loginPhoneNumber?: string;
    email?: string;
    description?: string;
    gstNumber?: string;
    panNumber?: string;
    profileImageUrl?: string;
  }): VendorDdbItem {
    const timestamp = new Date().toISOString();
    const status = DEFAULT_STATUS;
    const operationalStatus = DEFAULT_OPERATIONAL_STATUS;
    const  businessType = input. businessType ?? 'BUSINESS';
    const onboarding = computeOnboardingState({
      hasBusinessInfo: isBusinessInfoComplete({
         businessType,
        businessName: input.businessName,
        contactName: input.contactName,
        phoneNumber: input.phoneNumber,
      }),
      hasCommunities: false,
      documentTypes: [],
      hasBankDetails: false,
    });

    return {
      PK: VendorKeyBuilder.vendorPk(input.vendorId),
      SK: VendorKeyBuilder.vendorSk(),
      vendorId: input.vendorId,
      createdBy: input.createdBy,
       businessType,
      businessName: input.businessName,
      contactName: input.contactName,
      phoneNumber: input.phoneNumber,
      loginPhoneNumber: input.loginPhoneNumber,
      accountProvisioningStatus: input.loginPhoneNumber ? 'PENDING' : undefined,
      email: input.email,
      description: input.description,
      gstNumber: input.gstNumber,
      panNumber: input.panNumber,
      profileImageUrl: input.profileImageUrl,
      status,
      operationalStatus,
      onboardingStatus: onboarding.status,
      currentSection: onboarding.currentSection,
      completedSections: onboarding.completedSections,
      revision: 0,
      communityIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...VendorKeyBuilder.vendorDiscoveryKeys(
        status,
        operationalStatus,
        timestamp,
        input.vendorId,
      ),
      entityType: VENDOR_ENTITY_TYPE,
    };
  }

  /** Rebuild keys whenever a PROFILE is created or replaced. */
  static withDiscoveryKeys(profile: VendorDdbItem): VendorDdbItem {
    return {
      ...profile,
      ...VendorKeyBuilder.vendorDiscoveryKeys(
        profile.status,
        profile.operationalStatus,
        profile.createdAt,
        profile.vendorId,
      ),
    };
  }

  static applyBusinessInfo(
    existing: VendorDdbItem,
    data: {
       businessType:  businessType;
      businessName: string;
      contactName: string;
      phoneNumber: string;
      email?: string;
      description?: string;
      gstNumber?: string;
      panNumber?: string;
      profileImageUrl?: string;
    },
  ): VendorDdbItem {
    return VendorsMapper.withDiscoveryKeys({
      ...existing,
       businessType: data. businessType,
      businessName: data.businessName,
      contactName: data.contactName,
      phoneNumber: data.phoneNumber,
      email: data.email,
      description: data.description,
      gstNumber: data.gstNumber,
      panNumber: data.panNumber,
      profileImageUrl: data.profileImageUrl ?? existing.profileImageUrl,
      updatedAt: new Date().toISOString(),
      revision: (existing.revision ?? 0) + 1,
    });
  }

  static applyUpdate(
    existing: VendorDdbItem,
    updates: UpdateVendorRequest,
  ): VendorDdbItem {
    return VendorsMapper.withDiscoveryKeys({
      ...existing,
      businessType: updates.businessType ?? existing.businessType,
      businessName: updates.businessName ?? existing.businessName,
      contactName: updates.contactName ?? existing.contactName,
      phoneNumber: updates.phoneNumber ?? existing.phoneNumber,
      email: updates.email !== undefined ? updates.email : existing.email,
      description:
        updates.description !== undefined
          ? updates.description
          : existing.description,
      gstNumber:
        updates.gstNumber !== undefined ? updates.gstNumber : existing.gstNumber,
      panNumber:
        updates.panNumber !== undefined ? updates.panNumber : existing.panNumber,
      profileImageUrl:
        updates.profileImageUrl !== undefined
          ? updates.profileImageUrl
          : existing.profileImageUrl,
      updatedAt: new Date().toISOString(),
      revision: (existing.revision ?? 0) + 1,
      concent: updates.concent ?? existing.concent ?? false,
    });
  }

  /** Persists manager confirmation against the current profile revision. */
  static applyDetailsAcceptance(
    existing: VendorDdbItem,
    input: { revision: number; acceptedAt: string },
  ): VendorDdbItem {
    return VendorsMapper.withDiscoveryKeys({
      ...existing,
      detailsAcceptedRevision: input.revision,
      detailsAcceptedAt: input.acceptedAt,
      updatedAt: input.acceptedAt,
    });
  }

  static toReview(record: VendorStatusReviewRecord): VendorStatusReview {
    return {
      previousStatus: record.previousStatus,
      newStatus: record.newStatus,
      reviewerUserId: record.reviewerUserId,
      reason: record.reason,
      reviewedAt: record.reviewedAt,
      correlationId: record.correlationId,
    };
  }

  static applyLifecycleTransition(
    existing: VendorDdbItem,
    input: {
      status: VendorStatus;
      reviewerUserId: string;
      reason?: string;
      reviewedAt: string;
      correlationId?: string;
    },
  ): VendorDdbItem {
    const reason = input.reason?.trim() ?? '';
    const latestReview: VendorStatusReviewRecord = {
      previousStatus: existing.status,
      newStatus: input.status,
      reviewerUserId: input.reviewerUserId,
      reviewedAt: input.reviewedAt,
      ...(reason ? { reason } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };

    return VendorsMapper.withDiscoveryKeys({
      ...existing,
      status: input.status,
      latestReview,
      updatedAt: input.reviewedAt,
      meta: input.correlationId
        ? { ...existing.meta, correlationId: input.correlationId }
        : existing.meta,
    });
  }

  static toStatusHistoryItem(
    profile: VendorDdbItem,
    historyId: string,
  ): VendorStatusHistoryDdbItem {
    const review = profile.latestReview;
    if (!review) {
      throw new Error('Status history requires latestReview on the vendor profile');
    }

    return {
      PK: VendorKeyBuilder.vendorPk(profile.vendorId),
      SK: VendorKeyBuilder.statusHistorySk(review.reviewedAt, historyId),
      vendorId: profile.vendorId,
      previousStatus: review.previousStatus,
      newStatus: review.newStatus,
      reviewerUserId: review.reviewerUserId,
      reviewedAt: review.reviewedAt,
      ...(review.reason ? { reason: review.reason } : {}),
      ...(review.correlationId ? { correlationId: review.correlationId } : {}),
      entityType: VENDOR_STATUS_HISTORY_ENTITY_TYPE,
    };
  }

  static applyCommunityIds(
    existing: VendorDdbItem,
    communityIds: string[],
    updatedAt: string,
  ): VendorDdbItem {
    return {
      ...existing,
      communityIds,
      updatedAt,
    };
  }

  static applyOperationalStatusUpdate(
    existing: VendorDdbItem,
    operationalStatus: OperationalStatus,
  ): VendorDdbItem {
    return VendorsMapper.withDiscoveryKeys({
      ...existing,
      operationalStatus,
      updatedAt: new Date().toISOString(),
    });
  }

  static applyOnboardingState(
    existing: VendorDdbItem,
    state: {
      onboardingStatus: OnboardingStatus;
      currentSection: OnboardingSection;
      completedSections: OnboardingSection[];
      primaryBranchId?: string;
      addressCity?: string;
      addressPostalCode?: string;
      concent?: boolean;
      applicationId?: string;
      email?: string;
      meta?: { correlationId?: string };
    },
  ): VendorDdbItem {
    const updated: VendorDdbItem = {
      ...existing,
      onboardingStatus: state.onboardingStatus,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      primaryBranchId: state.primaryBranchId ?? existing.primaryBranchId,
      updatedAt: new Date().toISOString(),
    };

    if (state.applicationId) {
      updated.applicationId = existing.applicationId ?? state.applicationId;
    }

    if (!updated.email && state.email) {
      updated.email = state.email;
    }

    if (state.meta?.correlationId) {
      updated.meta = {
        ...existing.meta,
        correlationId: state.meta.correlationId,
      };
    }

    if (state.addressCity && state.addressPostalCode) {
      updated.addressCity = state.addressCity;
      updated.addressPostalCode = state.addressPostalCode;
      updated.GSI2PK = VendorKeyBuilder.gsi2Pk(state.addressCity);
      updated.GSI2SK = VendorKeyBuilder.gsi2Sk(
        state.addressPostalCode,
        existing.createdAt,
        existing.vendorId,
      );
    }

    return VendorsMapper.withDiscoveryKeys(updated);
  }

  static toAddressDdbItem(
    vendorId: string,
    data: VendorAddressDdbItem | {
      addressLine1: string;
      addressLine2?: string;
      landmark?: string;
      locality?: string;
      city: string;
      district?: string;
      state: string;
      country: string;
      postalCode: string;
      geoLocation?: VendorAddressDdbItem['geoLocation'];
    },
    options?: { createdAt?: string },
  ): VendorAddressDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt =
      ('createdAt' in data && data.createdAt) || options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.addressSk(),
      vendorId,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      landmark: data.landmark,
      locality: data.locality,
      city: data.city,
      district: data.district,
      state: data.state,
      country: data.country,
      postalCode: data.postalCode,
      geoLocation: data.geoLocation,
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_ADDRESS_ENTITY_TYPE,
      concent:  false,
    };
  }

  static toAddressDomain(item: VendorAddressDdbItem): VendorAddress {
    return {
      vendorId: item.vendorId,
      addressLine1: item.addressLine1,
      addressLine2: item.addressLine2,
      landmark: item.landmark,
      locality: item.locality,
      city: item.city,
      district: item.district,
      state: item.state,
      country: item.country,
      postalCode: item.postalCode,
      geoLocation: item.geoLocation,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
