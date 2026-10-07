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
  VendorType,
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
      vendorType: item.vendorType,
      businessName: item.businessName,
      contactName: item.contactName,
      phoneNumber: item.phoneNumber,
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
      city: item.city,
      state: item.state,
      country: item.country,
      postalCode: item.postalCode,
    };
  }

  static toInitialDdbItem(input: {
    vendorId: string;
    ownerUserId: string;
    vendorType?: VendorType;
    businessName?: string;
    contactName?: string;
    phoneNumber?: string;
    email?: string;
    description?: string;
    gstNumber?: string;
    panNumber?: string;
    profileImageUrl?: string;
  }): VendorDdbItem {
    const timestamp = new Date().toISOString();
    const status = DEFAULT_STATUS;
    const operationalStatus = DEFAULT_OPERATIONAL_STATUS;
    const vendorType = input.vendorType ?? 'BUSINESS';
    const onboarding = computeOnboardingState({
      hasBusinessInfo: isBusinessInfoComplete({
        vendorType,
        businessName: input.businessName,
        contactName: input.contactName,
        phoneNumber: input.phoneNumber,
      }),
      hasOwner: false,
      hasAddress: false,
      hasBranch: false,
      documentTypes: [],
      hasBankDetails: false,
    });

    return {
      PK: VendorKeyBuilder.vendorPk(input.vendorId),
      SK: VendorKeyBuilder.vendorSk(),
      vendorId: input.vendorId,
      ownerUserId: input.ownerUserId,
      vendorType,
      businessName: input.businessName,
      contactName: input.contactName,
      phoneNumber: input.phoneNumber,
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
      communityIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      GSI1PK: VendorKeyBuilder.gsi1Pk(),
      GSI1SK: VendorKeyBuilder.gsi1Sk(
        status,
        operationalStatus,
        timestamp,
        input.vendorId,
      ),
      entityType: VENDOR_ENTITY_TYPE,
    };
  }

  static applyBusinessInfo(
    existing: VendorDdbItem,
    data: {
      vendorType: VendorType;
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
    return {
      ...existing,
      vendorType: data.vendorType,
      businessName: data.businessName,
      contactName: data.contactName,
      phoneNumber: data.phoneNumber,
      email: data.email,
      description: data.description,
      gstNumber: data.gstNumber,
      panNumber: data.panNumber,
      profileImageUrl: data.profileImageUrl ?? existing.profileImageUrl,
      updatedAt: new Date().toISOString(),
    };
  }

  static applyUpdate(
    existing: VendorDdbItem,
    updates: UpdateVendorRequest,
  ): VendorDdbItem {
    return {
      ...existing,
      businessName: updates.businessName ?? existing.businessName,
      contactName: updates.contactName ?? existing.contactName,
      phoneNumber: updates.phoneNumber ?? existing.phoneNumber,
      email: updates.email !== undefined ? updates.email : existing.email,
      description:
        updates.description !== undefined
          ? updates.description
          : existing.description,
      profileImageUrl:
        updates.profileImageUrl !== undefined
          ? updates.profileImageUrl
          : existing.profileImageUrl,
      updatedAt: new Date().toISOString(),
    };
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
    const reason = input.reason?.trim();
    const latestReview: VendorStatusReviewRecord = {
      previousStatus: existing.status,
      newStatus: input.status,
      reviewerUserId: input.reviewerUserId,
      reviewedAt: input.reviewedAt,
      ...(reason ? { reason } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };

    return {
      ...existing,
      status: input.status,
      latestReview,
      updatedAt: input.reviewedAt,
      GSI1SK: VendorKeyBuilder.gsi1Sk(
        input.status,
        existing.operationalStatus,
        existing.createdAt,
        existing.vendorId,
      ),
      meta: input.correlationId
        ? { ...existing.meta, correlationId: input.correlationId }
        : existing.meta,
    };
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
    return {
      ...existing,
      operationalStatus,
      updatedAt: new Date().toISOString(),
      GSI1SK: VendorKeyBuilder.gsi1Sk(
        existing.status,
        operationalStatus,
        existing.createdAt,
        existing.vendorId,
      ),
    };
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

    return updated;
  }

  static toAddressDdbItem(
    vendorId: string,
    data: VendorAddressDdbItem | {
      addressLine1: string;
      addressLine2?: string;
      landmark?: string;
      city: string;
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
      city: data.city,
      state: data.state,
      country: data.country,
      postalCode: data.postalCode,
      geoLocation: data.geoLocation,
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_ADDRESS_ENTITY_TYPE,
    };
  }

  static toAddressDomain(item: VendorAddressDdbItem): VendorAddress {
    return {
      vendorId: item.vendorId,
      addressLine1: item.addressLine1,
      addressLine2: item.addressLine2,
      landmark: item.landmark,
      city: item.city,
      state: item.state,
      country: item.country,
      postalCode: item.postalCode,
      geoLocation: item.geoLocation,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
