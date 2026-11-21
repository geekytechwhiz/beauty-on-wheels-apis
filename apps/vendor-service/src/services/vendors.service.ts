/* eslint-disable mvrx/enforce-platform-logger */
/* eslint-disable no-console */
import {
  DynamoDbAuthUserDirectory,
  type AuthUserDirectory,
} from '@api-hub/authentication-core';
import { createChildLogger, createLogger, getLoggerContext } from '@api-hub/observability';
import {
  ConditionalWriteConflictError, ConflictError, LambdaRequest, NotFoundError,
  ValidationError, normalizePhoneNumber, EntityIdGenerator,
} from '@api-hub/utils';
import { randomUUID } from 'crypto';

import { CapabilitiesMapper } from '../mappers/capabilities.mapper';
import { CommunitiesMapper } from '../mappers/communities.mapper';
import { OwnerMapper } from '../mappers/owner.mapper';
import { VendorsMapper } from '../mappers/vendors.mapper';
import {
  CommunitiesRepository,
  getCommunitiesRepository,
} from '../repositories/communities.repository';
import {
  getVendorsRepository,
  VendorPageResult,
  VendorsRepository,
} from '../repositories/vendors.repository';
import { getStaffRepository, StaffRepository } from '../repositories/staff.repository';
 
import {
  isCommunityId,
  normalizeCommunityId,
  resolveCoverageApprovalStatus,
  uniqueCommunityIds,
} from '../domain/community';
import {
  generateVendorEmailVerificationOtp,
  hashVendorEmailVerificationToken,
  hasValidRegisteredEmail,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
} from '../domain/email-verification';
import {
  assertOperationalStatusAllowed,
  decideVendorStatusTransition,
  isVendorApproval,
  isVendorRejection,
} from '../domain/lifecycle';
import {
  computeOnboardingState,
  isBusinessInfoComplete,
  isOnboardingMutable,
  preservedOnboardingStatus,
} from '../domain/onboarding';
import {
  computeStateFromAggregate,
  toVendorAggregate,
} from '../domain/vendor-aggregate';
import {
  isOnboardingComplete,
  OWNER_WORKSPACE_PERMISSIONS,
  resolveVendorNextAction,
  resolveVendorSelfStatus,
  STAFF_VISIT_PERMISSIONS,
  toDetailsAcceptance,
  VENDOR_MEMBERSHIP_ROLE,
  VENDOR_NEXT_ACTION,
} from '../domain/vendor-self';
import { env } from '../configs/env.config';
import { ensureCanonicalUserId } from '../auth/resolve-canonical-user';
import {
  AcceptVendorDetailsRequest,
  CreateVendorRequest,
  CreateVendorRequestSchema,
} from '../schemas/vendors.schema';
import {
  CapabilitiesRepository,
  getCapabilitiesRepository,
} from '../repositories/capabilities.repository';
import {
  CapabilitiesService,
  getCapabilitiesService,
} from './capabilities.service';
import {
  CommunityPostalPlaceLookup,
  PostalPlaceLookup,
  ResolvedPostalPlace,
} from '../integrations/postal-place-lookup';
import {
  ApproveVendorRequest,
  OperationalStatus,
  RejectVendorRequest,
  UpdateOperationalStatusRequest,
  UpdateVendorRequest,
  UpdateVendorStatusRequest,
  Vendor,
  VendorListResponse,
  VendorOnboardingSnapshot,
  VendorSelfLookup,
  VendorStatus,
  VendorStatusHistoryEntry
} from '../types/api-types';
import {
  VendorAddressDdbItem,
  VendorCapabilitiesDdbItem,
  VendorCommunityDdbItem,
  VendorDdbItem,
  VendorIndicativeCapacityDdbItem,
  VendorOperatingPreferencesDdbItem,
} from '../types/repository.types';
import {
  VENDOR_INDICATIVE_CAPACITY_ENTITY_TYPE,
  VENDOR_OPERATING_PREFERENCES_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';
import {
  assertActiveVendorRoute,
  assertAdminAccess,
  assertCanCreateVendor,
  decodeCursor,
  encodeCursor,
  getAuthenticatedUserId,
  getVendorId,
  isRegistrationOnlyCaller,
  parseLimit,
  assertVendorAccess,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'vendors-service',
  redactPII: true,
});

const VALID_VENDOR_STATUSES: VendorStatus[] = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'REJECTED',
];

const VALID_OPERATIONAL_STATUSES: OperationalStatus[] = [
  'ONLINE',
  'OFFLINE',
  'BUSY',
  'TEMPORARILY_UNAVAILABLE',
];

export class VendorsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'VendorsService',
  });

  private readonly postalLookup: PostalPlaceLookup;

  constructor(
    private readonly repository: VendorsRepository = getVendorsRepository(),
    private readonly communitiesRepository: CommunitiesRepository = getCommunitiesRepository(),
    private readonly staff: StaffRepository = getStaffRepository(),
    private readonly identityDirectory?: AuthUserDirectory,
    private readonly capabilitiesRepository: CapabilitiesRepository = getCapabilitiesRepository(),
    private readonly capabilities: Pick<CapabilitiesService, 'buildInitialCapabilities'> = getCapabilitiesService(),
    postalLookup?: PostalPlaceLookup,
  ) {
    this.postalLookup = postalLookup ?? new CommunityPostalPlaceLookup(communitiesRepository);
  }

  private async requireVendor(vendorId: string) {
    const item = await this.repository.getVendorById(vendorId);
    if (!item) {
      throw new NotFoundError('Vendor not found');
    }
    return item;
  }

  private toListResponse(result: VendorPageResult): VendorListResponse {
    const nextCursor = encodeCursor(result.lastEvaluatedKey);

    return {
      data: result.items.map((item) => VendorsMapper.toDomain(item)),
      pagination: {
        nextCursor,
        hasMore: Boolean(result.lastEvaluatedKey),
        total: null,
        totalAvailability: 'unavailable',
        totalReason:
          'data.length is this page only. Exhaust nextCursor before counting vendors. Approved or operational status on this page is not the partner population, and onboarding estimates are not committed supply.',
      },
    };
  }

  async getMyVendor(request: LambdaRequest): Promise<VendorSelfLookup> {
    // assertActiveVendorRoute(request);
    const userId = getAuthenticatedUserId(request);
    const vendor = await this.lookupOwnedVendor(userId);

    if (!vendor) {
      const memberships = await this.staff.listMembershipsByUserId(userId);
      const membership = memberships.find((item) => item.status === 'ACTIVE') ?? memberships[0];
      if (!membership) {
        return {
          hasVendor: false,
          nextAction: VENDOR_NEXT_ACTION.START_ONBOARDING,
        };
      }
      const employer = await this.repository.getVendorById(membership.vendorId);
      if (!employer) {
        return {
          hasVendor: false,
          nextAction: VENDOR_NEXT_ACTION.START_ONBOARDING,
        };
      }
      const active = membership.status === 'ACTIVE' && employer.status === 'ACTIVE';
      return {
        hasVendor: true,
        vendorId: employer.vendorId,
        status: resolveVendorSelfStatus(employer),
        nextAction: active ? VENDOR_NEXT_ACTION.OPEN_VENDOR_DASHBOARD : VENDOR_NEXT_ACTION.VIEW_ACCOUNT_STATUS,
        membership: {
          role: VENDOR_MEMBERSHIP_ROLE.STAFF,
          staffId: membership.staffId,
          permissions: active ? [...STAFF_VISIT_PERMISSIONS] : [],
        },
      };
    }

    return {
      hasVendor: true,
      vendorId: vendor.vendorId,
      status: resolveVendorSelfStatus(vendor),
      onboarding: {
        currentStep: vendor.currentSection,
        completed: isOnboardingComplete(vendor.onboardingStatus),
      },
      nextAction: resolveVendorNextAction(vendor),
      membership: {
        role: VENDOR_MEMBERSHIP_ROLE.OWNER,
        permissions: [...OWNER_WORKSPACE_PERMISSIONS],
      },
      detailsAcceptance: toDetailsAcceptance(vendor),
    };
  }

  async createvendor(request: LambdaRequest): Promise<Vendor> {
    const createdBy = await this.prepareCreateOwner(request);
    const parsed = CreateVendorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid vendor registration request');
    }

    const input = normalizeCreateLocality(parsed.data);
    // Explicit vendor-login contact:
    // - Staff create: ownerDetails.phoneNumber (never createdBy / business phone).
    // - REGISTRANT self-create: ownerDetails.phoneNumber, else the verified auth phone.
    const rawLoginPhone =
      input.ownerDetails?.phoneNumber?.trim() ||
      (isRegistrationOnlyCaller(request)
        ? request.context.authContext?.phoneNumber?.trim()
        : undefined);
    if (!rawLoginPhone) {
      throw new ValidationError(
        'ownerDetails.phoneNumber is required for vendor account provisioning',
      );
    }
    const phoneDetails = normalizePhoneNumber(rawLoginPhone);
    if (!phoneDetails.isValid || !phoneDetails.e164) {
      throw new ValidationError('ownerDetails.phoneNumber must be a valid phone number');
    }
    return this.createOwnedVendor(input, createdBy, phoneDetails.e164, request);
  }

  /**
   * Owner id comes from the authorizer user id or the identity mapping.
   * A REGISTRANT phone is read from that same trusted record.
   */
  private async prepareCreateOwner(request: LambdaRequest): Promise<string> {
    const auth = request.context.authContext;
    if (auth?.identityId && !auth.userId?.trim()) {
      await ensureCanonicalUserId(request, this.identityDirectory);
    }
    if (isRegistrationOnlyCaller(request)) {
      await this.hydrateVerifiedPhone(request);
    }
    return assertCanCreateVendor(request);
  }

  private identityLookup(): AuthUserDirectory | undefined {
    if (this.identityDirectory) {
      return this.identityDirectory;
    }
    return env.IDENTITY_TABLE
      ? new DynamoDbAuthUserDirectory(env.IDENTITY_TABLE)
      : undefined;
  }

  private async hydrateVerifiedPhone(request: LambdaRequest): Promise<void> {
    const auth = request.context.authContext;
    if (!auth?.identityId || auth.phoneVerified === false) {
      return;
    }
    if (auth.phoneVerified === true && auth.phoneNumber?.trim()) {
      return;
    }
    const directory = this.identityLookup();
    if (!directory) {
      return;
    }
    const user = await directory.findUserByIdentityId(auth.identityId);
    if (!user) {
      return;
    }
    if (typeof user.phoneVerified === 'boolean') {
      auth.phoneVerified = user.phoneVerified;
    }
    if (user.phoneNumber?.trim()) {
      auth.phoneNumber = user.phoneNumber.trim();
    }
  }

 
  private async createOwnedVendor(
    input: CreateVendorRequest,
    createdBy: string,
    verifiedPhone: string | undefined,
    request: LambdaRequest,
  ): Promise<Vendor> {
    const businessInfo = { ...(input.businessInfo ?? {}) };
    const ownerDetails = { ...(input.ownerDetails ?? {}) };
    // Do not overwrite business contact data with the vendor login contact.
    const locationInput = businessInfo.location;
    delete businessInfo.location;
    delete businessInfo.locality;

    // const existing = await this.findOwnedVendor(ownerUserId);
    // if (existing) {
    //   return this.presentVendor(existing);
    // }

    // const place = locationInput
    //   ? await this.postalLookup.resolve({
    //     postalCode: locationInput.postalCode,
    //     countryCode: locationInput.countryCode ?? 'IN',
    //     locality: locationInput.locality,
    //   })
    //   : undefined;
    // if (place && locationInput) {
    //   assertPlaceMatchesRequest(locationInput, place);
    // }

    const communityIds = await this.requestedCommunityIds(input);
    const vendorId = EntityIdGenerator.VendorId();
    const createdAt = new Date().toISOString();

    let profile = VendorsMapper.toInitialDdbItem({
      ...businessInfo,
      vendorId,
      createdBy,
      loginPhoneNumber: verifiedPhone,
    });
    profile = { ...profile, createdAt, updatedAt: createdAt };
    profile = VendorsMapper.withDiscoveryKeys(profile);

    const address = locationInput
      ? VendorsMapper.toAddressDdbItem(
          vendorId,
          {
            addressLine1: locationInput?.addressLine1?.trim() ?? '',
            addressLine2: blankToUndefined(locationInput?.addressLine2),
            landmark: blankToUndefined(locationInput?.landmark),
            locality: locationInput.locality,
            city: locationInput.city,
            district: locationInput.district,
            state: locationInput.state,
            country:  'IN',
            postalCode: locationInput.postalCode 
          },
          { createdAt },
        )
      : undefined;

    const capabilities = input.capabilities
      ? await this.capabilities.buildInitialCapabilities(vendorId, input.capabilities, request)
      : undefined;
    const operatingPreferences = input.operatingPreferences
      ? this.operatingPreferencesItem(vendorId, input.operatingPreferences.serviceWindowIds, createdAt)
      : undefined;
    const indicativeCapacity = input.initialCapacity
      ? this.indicativeCapacityItem(vendorId, input.initialCapacity, createdAt)
      : undefined;
    const communityItems = communityIds.map((communityId) =>
      CommunitiesMapper.toItem({
        vendor: profile,
        communityId,
        assignedBy: createdBy,
        assignedAt: createdAt,
      }),
    );

    const sectionItems: Array<Record<string, unknown>> = [];
    if (address) sectionItems.push(address as unknown as Record<string, unknown>);
    if (capabilities) sectionItems.push(capabilities as unknown as Record<string, unknown>);
    if (operatingPreferences) sectionItems.push(operatingPreferences as unknown as Record<string, unknown>);
    if (indicativeCapacity) sectionItems.push(indicativeCapacity as unknown as Record<string, unknown>);
    const fitsInOneTransaction = sectionItems.length + communityItems.length <= 22;
    if (fitsInOneTransaction) {
      profile = { ...profile, communityIds };
    } else {
      profile = {
        ...profile,
        communityIds: [],
        pendingCommunityIds: communityIds,
        onboardingPersistence: 'incomplete',
      };
    }

    const aggregate = toVendorAggregate([
      profile,
      ...(address ? [address] : []),
    ]);
    const state = computeStateFromAggregate(aggregate);
    const correlationId = correlationFromContext();
    profile = VendorsMapper.applyOnboardingState(profile, {
      onboardingStatus: state.status,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      email: profile.email ?? ownerDetails.email,
      addressCity: locationInput?.city,
      addressPostalCode: locationInput?.postalCode,
      meta: correlationId ? { correlationId } : undefined,
    });
    if (!fitsInOneTransaction) {
      profile = {
        ...profile,
        pendingCommunityIds: communityIds,
        onboardingPersistence: 'incomplete',
      };
    }
    profile = this.withInitialEmailVerification(profile);

    const firstWrite: Array<Record<string, unknown>> = fitsInOneTransaction
      ? [...sectionItems, ...(communityItems as unknown as Array<Record<string, unknown>>)]
      : sectionItems;

    try {
      await this.repository.createVendor(
        profile,
        firstWrite,
      );
    } catch (error) {
      if (!(error instanceof ConditionalWriteConflictError)) {
        throw error;
      }

      throw new ConflictError('Vendor creation conflict; please retry');
    }

    if (!fitsInOneTransaction) {
      profile = await this.finishPendingCommunities(profile, communityItems);
    }

    this.logger.info({
      event: 'createvendor_success',
      createdBy,
      vendorId,
      correlationId,
      communityCount: communityIds.length,
    });

    return {
      ...VendorsMapper.toDomain(profile, address),
      onboarding: snapshotFromItems({
        address,
        capabilities,
        coverage: fitsInOneTransaction ? communityItems : communityItems,
        preferences: operatingPreferences,
        capacity: indicativeCapacity,
      }),
    };
  }

  private async requestedCommunityIds(input: CreateVendorRequest): Promise<string[]> {
    if (!input.communityCoverage) return [];
    const ids = uniqueCommunityIds(input.communityCoverage.communityIds.map(normalizeCommunityId));
    if (ids.length !== input.communityCoverage.communityIds.length) {
      throw new ValidationError('communityIds contains a duplicate');
    }
    if (ids.some((id) => !isCommunityId(id))) {
      throw new ValidationError('Invalid communityId');
    }
    const rejected: string[] = [];
    for (const communityId of ids) {
      const record = await this.communitiesRepository.getActiveCommunity(communityId);
      if (!record) rejected.push(communityId);
    }
    if (rejected.length) {
      throw new ValidationError(`Unknown or inactive community: ${rejected.join(', ')}`);
    }
    return ids;
  }

  private operatingPreferencesItem(
    vendorId: string,
    serviceWindowIds: string[],
    createdAt: string,
  ): VendorOperatingPreferencesDdbItem {
    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.operatingPreferencesSk(),
      vendorId,
      serviceWindowIds: [...serviceWindowIds],
      createdAt,
      updatedAt: createdAt,
      entityType: VENDOR_OPERATING_PREFERENCES_ENTITY_TYPE,
    };
  }

  private indicativeCapacityItem(
    vendorId: string,
    capacity: { activeCrewCount: number; indicativeVisitsPerWeek: number },
    createdAt: string,
  ): VendorIndicativeCapacityDdbItem {
    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.indicativeCapacitySk(),
      vendorId,
      activeCrewCount: capacity.activeCrewCount,
      indicativeVisitsPerWeek: capacity.indicativeVisitsPerWeek,
      capacityKind: 'indicative',
      createdAt,
      updatedAt: createdAt,
      entityType: VENDOR_INDICATIVE_CAPACITY_ENTITY_TYPE,
    };
  }

  private async finishPendingCommunities(
    profile: VendorDdbItem,
    prepared?: VendorCommunityDdbItem[],
  ): Promise<VendorDdbItem> {
    const ids = profile.pendingCommunityIds ?? [];
    const saved = await this.communitiesRepository.listByVendor(profile.vendorId, { consistent: true });
    const have = new Set(saved.map((item) => item.communityId));
    const missing = (prepared ?? ids.map((communityId) => CommunitiesMapper.toItem({
      vendor: profile,
      communityId,
      assignedBy: profile.createdBy ?? profile.ownerUserId ?? 'system',
      assignedAt: profile.createdAt,
    }))).filter((item) => !have.has(item.communityId));
    for (const item of missing) {
      try {
        await this.repository.putIfAbsent(item as unknown as Record<string, unknown>);
      } catch (error) {
        if (!(error instanceof ConditionalWriteConflictError)) throw error;
      }
    }
    const confirmed = await this.communitiesRepository.listByVendor(profile.vendorId, { consistent: true });
    const confirmedIds = new Set(confirmed.map((item) => item.communityId));
    const stillMissing = ids.filter((id) => !confirmedIds.has(id));
    if (stillMissing.length) {
      throw new ConflictError('Vendor onboarding is incomplete; please retry');
    }
    const state = computeOnboardingState({
      hasBusinessInfo: isBusinessInfoComplete(profile),
      hasCommunities: ids.length > 0,
      documentTypes: [],
      hasBankDetails: false,
    });
    const next: VendorDdbItem = {
      ...profile,
      communityIds: ids,
      onboardingStatus: state.status,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      updatedAt: new Date().toISOString(),
    };
    delete next.pendingCommunityIds;
    delete next.onboardingPersistence;
    await this.repository.updateVendor(next);
    return next;
  }

  private async presentVendor(profile: VendorDdbItem): Promise<Vendor> {
    const current = profile.onboardingPersistence === 'incomplete'
      ? await this.finishPendingCommunities(profile)
      : profile;
    const [address, capabilities, coverage, preferences, capacity] = await Promise.all([
      this.repository.getAddress(current.vendorId),
      this.capabilitiesRepository.getCapabilities(current.vendorId),
      this.communitiesRepository.listByVendor(current.vendorId, { consistent: true }),
      this.repository.getOperatingPreferences(current.vendorId),
      this.repository.getIndicativeCapacity(current.vendorId),
    ]);
    return {
      ...VendorsMapper.toDomain(current, address),
      onboarding: snapshotFromItems({
        address,
        capabilities,
        coverage,
        preferences,
        capacity,
      }),
    };
  }

  private withInitialEmailVerification(profile: VendorDdbItem): VendorDdbItem {
    if (
      profile.emailVerifiedAt ||
      profile.emailVerificationRequestId ||
      !hasValidRegisteredEmail(profile.email) ||
      !profile.contactName?.trim() ||
      !profile.businessName?.trim()
    ) {
      return profile;
    }

    const requestedAt = new Date();
    const token = generateVendorEmailVerificationOtp(profile.vendorId);

    return {
      ...profile,
      emailVerificationRequestId: randomUUID(),
      emailVerificationOtp: token,
      emailVerificationTokenHash: hashVendorEmailVerificationToken(token),
      emailVerificationEmail: profile.email,
      emailVerificationExpiryMinutes: VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
      emailVerificationRequestedAt: requestedAt.toISOString(),
      emailVerificationExpiresAt: new Date(
        requestedAt.getTime() +
          VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES * 60_000,
      ).toISOString(),
      emailVerificationDispatchPending: true,
    };
  }

  private async lookupOwnedVendor(
    userId: string,
  ): Promise<VendorDdbItem | null> {
    const owners = await this.repository.listOwnersByUserId(userId);
    const indexedIds = [
      ...new Set(
        owners
          .filter((item) => item.userId === userId)
          .map((item) => item.vendorId),
      ),
    ];
    const indexed = await this.profilesOwnedBy(userId, indexedIds);
    if (indexed.length > 0) {
      return this.earliestVendor(indexed);
    }

    const lockedVendorId = await this.repository.getOwnershipVendorId(userId);
    if (!lockedVendorId) {
      return null;
    }
    const locked = await this.repository.getVendorById(lockedVendorId);
    if (locked?.ownerUserId === userId) {
      return locked;
    }
    return null;
  }

  private async findOwnedVendor(userId: string): Promise<VendorDdbItem | null> {
    const lockedVendorId = await this.repository.getOwnershipVendorId(userId);
    if (lockedVendorId) {
      const locked = await this.repository.getVendorById(lockedVendorId);
      if (locked?.ownerUserId === userId) {
        return locked;
      }
      throw new ConflictError('Vendor ownership record is inconsistent');
    }

    const owners = await this.repository.listOwnersByUserId(userId);
    const vendorIds = [
      ...new Set(
        owners
          .filter((item) => item.userId === userId)
          .map((item) => item.vendorId),
      ),
    ];
    if (vendorIds.length === 0) {
      return null;
    }

    const profiles = (await this.repository.getVendorsByIds(vendorIds)).filter(
      (item) => item.ownerUserId === userId,
    );
    if (profiles.length === 0) {
      return null;
    }
    if (profiles.length > 1) {
      this.logger.warn({
        event: 'vendor_ownership_duplicates',
        userId,
        vendorIds: profiles.map((item) => item.vendorId),
      });
      return this.earliestVendor(profiles);
    }

    const vendor = profiles[0];
    try {
      await this.repository.putOwnershipIfAbsent(
        OwnerMapper.ownershipClaim(vendor.vendorId, userId),
      );
    } catch (err) {
      if (!(err instanceof ConditionalWriteConflictError)) {
        throw err;
      }
    }
    return vendor;
  }

  private async profilesOwnedBy(
    userId: string,
    vendorIds: string[],
  ): Promise<VendorDdbItem[]> {
    if (vendorIds.length === 0) {
      return [];
    }
    const profiles = await this.repository.getVendorsByIds(vendorIds);
    const owned = profiles.filter((item) => item.ownerUserId === userId);
    if (owned.length > 1) {
      this.logger.warn({
        event: 'vendor_ownership_duplicates',
        userId,
        vendorIds: owned.map((item) => item.vendorId),
      });
    }
    return owned;
  }

  private earliestVendor(items: VendorDdbItem[]): VendorDdbItem {
    return [...items].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )[0];
  }

  async listvendors(request: LambdaRequest): Promise<VendorListResponse> {
    const userId = assertAdminAccess(request);

    const status = request.params?.status as string | undefined;
    const operationalStatus = request.params?.operationalStatus as
      | string
      | undefined;
    const city = request.params?.city as string | undefined;
    const postalCode = request.params?.postalCode as string | undefined;
    const communityId = request.params?.communityId as string | undefined;
    const limit = parseLimit(request.params?.limit);
    const lastEvaluatedKey = decodeCursor(request.params?.cursor);

    this.logger.info({
      event: 'listvendors_start',
      userId,
      status,
      operationalStatus,
      city,
      postalCode,
      communityId,
      limit,
    });

    if (status && !VALID_VENDOR_STATUSES.includes(status as VendorStatus)) {
      throw new ValidationError(
        `Invalid status. Supported values: ${VALID_VENDOR_STATUSES.join(', ')}`,
      );
    }

    if (
      operationalStatus &&
      !VALID_OPERATIONAL_STATUSES.includes(
        operationalStatus as OperationalStatus,
      )
    ) {
      throw new ValidationError(
        `Invalid operationalStatus. Supported values: ${VALID_OPERATIONAL_STATUSES.join(', ')}`,
      );
    }

    if (communityId && (city || postalCode)) {
      throw new ValidationError(
        'communityId cannot be combined with city or postalCode filters',
      );
    }

    if (communityId && !isCommunityId(normalizeCommunityId(communityId))) {
      throw new ValidationError('Invalid communityId');
    }

    let result: VendorPageResult;

    if (communityId) {
      result = await this.listVendorsInCommunity({
        communityId: normalizeCommunityId(communityId),
        status: status as VendorStatus | undefined,
        operationalStatus: operationalStatus as OperationalStatus | undefined,
        limit,
        lastEvaluatedKey,
      });
    } else if (city) {
      result = await this.repository.listVendorsByCity({
        city,
        postalCode,
        limit,
        lastEvaluatedKey,
      });
    } else if (postalCode) {
      result = await this.repository.listVendorsByPostalCode({
        postalCode,
        limit,
        lastEvaluatedKey,
      });
    } else {
      result = await this.repository.listVendors({
        status: status as VendorStatus | undefined,
        operationalStatus: operationalStatus as OperationalStatus | undefined,
        limit,
        lastEvaluatedKey,
      });
    }

    const response = this.toListResponse(result);

    this.logger.info({
      event: 'listvendors_success',
      userId,
      count: response.data.length,
      hasMore: response.pagination?.hasMore,
    });

    return response;
  }

  async getvendor(request: LambdaRequest): Promise<Vendor> {
    const vendorId = getVendorId(request);
    const item = await this.requireVendor(vendorId);
    assertVendorAccess(request, item);
 

    this.logger.info({
      event: 'getvendor_start',
      vendorId,
    });

    const vendor = await this.presentVendor(item);

    this.logger.info({
      event: 'getvendor_success',
      vendorId,
    });

    return vendor;
  }

  async acceptVendorDetails(request: LambdaRequest): Promise<Vendor> {
    const vendorId = getVendorId(request);
    const existing = await this.requireVendor(vendorId);
    assertVendorAccess(request, existing);
    const body = request.body as AcceptVendorDetailsRequest;
    const currentRevision = existing.revision ?? 0;
    if (body.revision !== currentRevision) {
      throw new ConflictError(
        'Vendor details changed elsewhere. Reload and accept the current revision.',
      );
    }
    if (
      existing.detailsAcceptedRevision === currentRevision
      && existing.detailsAcceptedAt
    ) {
      return this.presentVendor(existing);
    }
    const acceptedAt = new Date().toISOString();
    const updated = VendorsMapper.applyDetailsAcceptance(existing, {
      revision: currentRevision,
      acceptedAt,
    });
    try {
      await this.repository.transactVendorProfile({
        profile: updated,
        expectedUpdatedAt: existing.updatedAt,
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor details acceptance conflict');
      }
      throw err;
    }
    this.logger.info({
      event: 'accept_vendor_details_success',
      vendorId,
      revision: currentRevision,
    });
    return this.presentVendor(updated);
  }

  async updatevendor(request: LambdaRequest): Promise<Vendor> {
    const vendorId = getVendorId(request);
    const existing = await this.requireVendor(vendorId);
    assertVendorAccess(request, existing);
    const body = request.body as UpdateVendorRequest;

    this.logger.info({
      event: 'updatevendor_start',
      vendorId,
    });

    let updated = VendorsMapper.applyUpdate(existing, body);
    if (isOnboardingMutable(existing.onboardingStatus)) {
      const aggregate = toVendorAggregate(
        await this.repository.queryVendorItems(vendorId),
      );
      aggregate.profile = updated;
      const state = computeStateFromAggregate(aggregate);
      updated = VendorsMapper.applyOnboardingState(updated, {
        onboardingStatus: preservedOnboardingStatus(
          existing.onboardingStatus,
          state.status,
        ),
        currentSection: state.currentSection,
        completedSections: state.completedSections,
        primaryBranchId: existing.primaryBranchId,
        addressCity: aggregate.address?.city,
        addressPostalCode: aggregate.address?.postalCode,
        concent: existing.concent ?? false,
      });
    }

    try {
      await this.repository.transactVendorProfile({
        profile: updated,
        expectedUpdatedAt: existing.updatedAt,
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor update conflict');
      }
      throw err;
    }

    this.logger.info({
      event: 'updatevendor_success',
      vendorId,
    });

    return this.presentVendor(updated);
  }

  async updatevendorstatus(request: LambdaRequest): Promise<Vendor> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = request.body as UpdateVendorStatusRequest;
    return this.transitionStatus(vendorId, userId, body.status, body.reason);
  }

  async approvevendor(request: LambdaRequest): Promise<Vendor> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = (request.body ?? {}) as ApproveVendorRequest;
    return this.transitionStatus(vendorId, userId, 'ACTIVE', body.reason);
  }

  async rejectvendor(request: LambdaRequest): Promise<Vendor> {
    const userId = assertAdminAccess(request);
    const vendorId = getVendorId(request);
    const body = request.body as RejectVendorRequest;
    return this.transitionStatus(vendorId, userId, 'REJECTED', body.reason);
  }

  async getvendorstatushistory(
    request: LambdaRequest,
  ): Promise<{ data: VendorStatusHistoryEntry[] }> {
    const vendorId = getVendorId(request);
    const item = await this.requireVendor(vendorId);
    assertVendorAccess(request, item); 
    
    const items = await this.repository.listStatusHistory(vendorId);
    return {
      data: items.map((item) => ({
        vendorId: item.vendorId,
        previousStatus: item.previousStatus,
        newStatus: item.newStatus,
        reviewerUserId: item.reviewerUserId,
        reason: item.reason,
        reviewedAt: item.reviewedAt,
        correlationId: item.correlationId,
      })),
    };
  }

  private async transitionStatus(
    vendorId: string,
    userId: string,
    status: VendorStatus,
    reason?: string,
  ): Promise<Vendor> {
    this.logger.info({
      event: 'updatevendorstatus_start',
      userId,
      vendorId,
      status,
    });

    const existing = await this.requireVendor(vendorId);
    const decision = decideVendorStatusTransition({
      from: existing.status,
      to: status,
      onboardingStatus: existing.onboardingStatus,
      reason,
    });

    if (decision.kind === 'invalid') {
      throw new ConflictError(decision.message);
    }

    if (decision.kind === 'idempotent') {
      this.logger.info({
        event: 'updatevendorstatus_idempotent',
        userId,
        vendorId,
        status,
      });
      return VendorsMapper.toDomain(existing);
    }

    const reviewedAt = new Date().toISOString();
    const correlationId = correlationFromContext();
    const updated = VendorsMapper.applyLifecycleTransition(existing, {
      status,
      reviewerUserId: userId,
      reason,
      reviewedAt,
      correlationId,
    });
    const history = VendorsMapper.toStatusHistoryItem(updated, randomUUID());
    const communities = await this.communitiesRepository.listByVendor(vendorId);
    const communityPuts = communities.map((item) => ({
      item: CommunitiesMapper.withVendorState(item, updated, reviewedAt),
      condition: 'exists' as const,
    }));

    try {
      await this.repository.transactVendorProfile({
        profile: updated,
        expectedStatus: existing.status,
        puts: [{ item: history, condition: 'not_exists' }, ...communityPuts],
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        const current = await this.repository.getVendorById(vendorId);
        if (current?.status === status) {
          return VendorsMapper.toDomain(current);
        }
        throw new ConflictError('Vendor status update conflict');
      }
      throw err;
    }

    const lifecycleEvent = isVendorApproval(existing.status, status)
      ? 'VendorApproved'
      : isVendorRejection(status)
        ? 'VendorRejected'
        : 'VendorUpdated';

    this.logger.info({
      event: lifecycleEvent,
      userId,
      vendorId,
      previousStatus: existing.status,
      newStatus: status,
      correlationId,
    });

    return VendorsMapper.toDomain(updated);
  }

  private async listVendorsInCommunity(params: {
    communityId: string;
    status?: VendorStatus;
    operationalStatus?: OperationalStatus;
    limit?: number;
    lastEvaluatedKey?: Record<string, unknown>;
  }): Promise<VendorPageResult> {
    const page = await this.communitiesRepository.listByCommunity(params);
    const profiles = await this.repository.getVendorsByIds(
      page.items.map((item) => item.vendorId),
    );
    const byId = new Map(profiles.map((item) => [item.vendorId, item]));
    const items = page.items
      .map((item) => byId.get(item.vendorId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      items,
      lastEvaluatedKey: page.lastEvaluatedKey,
    };
  }

  async updatevendoroperationalstatus(request: LambdaRequest): Promise<Vendor> {
    const vendorId = getVendorId(request);
    const existing = await this.requireVendor(vendorId);
    assertVendorAccess(request, existing);
 
    const body = request.body as UpdateOperationalStatusRequest;

    this.logger.info({
      event: 'updatevendoroperationalstatus_start',
      vendorId,
      operationalStatus: body?.operationalStatus,
    });

    const decision = assertOperationalStatusAllowed(
      existing.status,
      body.operationalStatus,
    );
    if (decision.kind === 'invalid') {
      throw new ConflictError(decision.message);
    }

    const updated = VendorsMapper.applyOperationalStatusUpdate(
      existing,
      body.operationalStatus,
    );
    const communities = await this.communitiesRepository.listByVendor(vendorId);

    try {
      await this.repository.transactVendorProfile({
        profile: updated,
        expectedUpdatedAt: existing.updatedAt,
        expectedStatus: existing.status,
        puts: communities.map((item) => ({
          item: CommunitiesMapper.withVendorState(
            item,
            updated,
            updated.updatedAt,
          ),
          condition: 'exists' as const,
        })),
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Vendor operational status update conflict');
      }
      throw err;
    }

    this.logger.info({
      event: 'updatevendoroperationalstatus_success',
      vendorId,
      operationalStatus: body.operationalStatus,
    });

    return VendorsMapper.toDomain(updated);
  }

  /**
   * Owner or staff membership for an authenticated user id.
   * The caller supplies the user id from the authorizer, never a client vendor id.
   */
  async resolveOperationalAccess(userId: string): Promise<{
    role: 'owner' | 'staff' | 'none';
    vendorId?: string;
    staffId?: string;
    active: boolean;
  }> {
    const trimmed = userId.trim();
    if (!trimmed) {
      return { role: 'none', active: false };
    }
    const owned = await this.lookupOwnedVendor(trimmed);
    if (owned) {
      return {
        role: 'owner',
        vendorId: owned.vendorId,
        active: owned.status === 'ACTIVE',
      };
    }
    const memberships = await this.staff.listMembershipsByUserId(trimmed);
    const membership = memberships.find((item) => item.status === 'ACTIVE') ?? memberships[0];
    if (!membership) return { role: 'none', active: false };
    const employer = await this.repository.getVendorById(membership.vendorId);
    if (!employer) return { role: 'none', active: false };
    return {
      role: 'staff',
      vendorId: employer.vendorId,
      staffId: membership.staffId,
      active: membership.status === 'ACTIVE' && employer.status === 'ACTIVE',
    };
  }
}

let service: VendorsService;

function normalizeCreateLocality(input: CreateVendorRequest): CreateVendorRequest {
  const info = input.businessInfo;
  if (!info) return input;
  const legacy = info.locality;
  const location = info.location;
  if (!legacy && !location) {
    return { ...input, businessInfo: { ...info, locality: undefined } };
  }
  return {
    ...input,
    businessInfo: {
      ...info,
      locality: undefined,
      location: {
        ...location!,
        locality: location?.locality ?? legacy,
      },
    },
  };
}

function assertPlaceMatchesRequest(
  submitted: {
    locality?: string;
    city?: string;
    district?: string;
    state?: string;
    countryCode?: string;
  },
  resolved: ResolvedPostalPlace,
): void {
  const checks: Array<[string, string | undefined, string]> = [
    ['businessInfo.location.locality', submitted.locality, resolved.locality],
    ['businessInfo.location.city', submitted.city, resolved.city],
    ['businessInfo.location.district', submitted.district, resolved.district],
    ['businessInfo.location.state', submitted.state, resolved.state],
    ['businessInfo.location.countryCode', submitted.countryCode, resolved.countryCode],
  ];
  for (const [field, value, expected] of checks) {
    if (!value) continue;
    if (value.trim().toLowerCase() !== expected.trim().toLowerCase()) {
      throw new ValidationError(`${field} does not match the postal directory value "${expected}"`);
    }
  }
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function snapshotFromItems(input: {
  address?: VendorAddressDdbItem | null;
  capabilities?: VendorCapabilitiesDdbItem | null;
  coverage?: VendorCommunityDdbItem[] | null;
  preferences?: VendorOperatingPreferencesDdbItem | null;
  capacity?: VendorIndicativeCapacityDdbItem | null;
}): VendorOnboardingSnapshot {
  const capabilities = input.capabilities
    ? CapabilitiesMapper.toDomain(input.capabilities)
    : undefined;
  const coverage = input.coverage ?? [];
  return {
    location: input.address?.locality && input.address.district
      ? {
        addressLine1: input.address.addressLine1 || undefined,
        addressLine2: input.address.addressLine2,
        landmark: input.address.landmark,
        locality: input.address.locality,
        city: input.address.city,
        district: input.address.district,
        state: input.address.state,
        postalCode: input.address.postalCode,
        countryCode: input.address.country,
      }
      : null,
    capabilities: {
      vehicleTypes: capabilities?.vehicleTypes ?? [],
      serviceIds: capabilities?.serviceIds ?? [],
      packageIds: capabilities?.packageIds ?? [],
      washMethods: capabilities?.washMethods ?? [],
    },
    communityCoverage: {
      communityIds: coverage.map((item) => item.communityId),
      communities: coverage.map((item) => ({
        communityId: item.communityId,
        approvalStatus: resolveCoverageApprovalStatus(item),
      })),
    },
    operatingPreferences: {
      serviceWindowIds: input.preferences?.serviceWindowIds ?? [],
    },
    initialCapacity: input.capacity
      ? {
        activeCrewCount: input.capacity.activeCrewCount,
        indicativeVisitsPerWeek: input.capacity.indicativeVisitsPerWeek,
        capacityKind: 'indicative',
      }
      : null,
  };
}

function correlationFromContext(): string | undefined {
  const correlationId = getLoggerContext()?.correlationId;
  if (!correlationId || correlationId === 'unknown') {
    return undefined;
  }
  return correlationId;
}

export function getVendorsService() {
  if (!service) {
    service = new VendorsService();
  }

  return service;
}
