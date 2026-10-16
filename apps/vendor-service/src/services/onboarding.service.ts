import { createChildLogger, createLogger, getLoggerContext } from '@api-hub/observability';
import {
  ConditionalWriteConflictError,
  ConflictError, LambdaRequest, NotFoundError,
  ValidationError
} from '@api-hub/utils';
import { randomUUID } from 'crypto';

import {
  assertDocumentsMutable,
  createDocumentObjectKey,
  parseDocumentUploadRequest,
  // requiredDocumentGaps,
} from '../domain/document-upload';
import {
  generateVendorEmailVerificationOtp,
  hashVendorEmailVerificationToken,
  hasValidRegisteredEmail,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
} from '../domain/email-verification';
import {
  ONBOARDING_SECTION,
  ONBOARDING_SECTION_ORDER,
  ONBOARDING_STATUS,
} from '../domain/onboarding';
import {
  computeStateFromAggregate,
  toVendorAggregate,
  VendorAggregate,
} from '../domain/vendor-aggregate';
import {
  BankDetailsMapper,
  BranchesMapper,
} from '../mappers/bank-and-branches.mapper';
import { DocumentsMapper } from '../mappers/documents.mapper';
import { OwnerMapper } from '../mappers/owner.mapper';
import { VendorsMapper } from '../mappers/vendors.mapper';
import {
  BranchesRepository,
  getBranchesRepository,
} from '../repositories/branches.repository';
import {
  DocumentsRepository,
  getDocumentsRepository,
} from '../repositories/documents.repository';
import {
  getVendorsRepository,
  VendorsRepository,
} from '../repositories/vendors.repository';
import {
  DocumentStorage,
  getDocumentStorage,
} from '../storage/document-storage';
import {
  AddressData,
  BankDetailsData,
  BranchData,
  BusinessInfoAndOwnerData,
  BusinessInfoData,
  DocumentsData,
  OnboardingResponse,
  OnboardingSection,
  OwnerDetailsData,
  ServiceLocationAndCoverageData,
  Vendor,
} from '../types/api-types';
import {
  VendorAddressDdbItem,
  VendorBankDdbItem,
  VendorBranchDdbItem,
  VendorDdbItem,
} from '../types/repository.types';
import {
  getVendorId
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'onboarding-service',
  redactPII: true,
});

export class OnboardingService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'OnboardingService',
  });

  constructor(
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
    private readonly branchesRepository: BranchesRepository = getBranchesRepository(),
    private readonly documentsRepository: DocumentsRepository = getDocumentsRepository(),
    private readonly documentStorage: DocumentStorage = getDocumentStorage(),
  ) {}

  private async requireVendor(vendorId: string): Promise<VendorDdbItem> {
    const item = await this.vendorsRepository.getVendorById(vendorId);
    if (!item) {
      this.logger.info({
        event: 'require_vendor_not_found',
        vendorId,
      });
      throw new NotFoundError('Vendor not found');
    }
    this.logger.info({
      event: 'require_vendor_found',
      vendorId,
      onboardingStatus: item.onboardingStatus,
      applicationId: item.applicationId,
    });
    return item;
  }

  private async loadAggregate(vendorId: string): Promise<VendorAggregate> {
    const items = await this.vendorsRepository.queryVendorItems(vendorId);
    const aggregate = toVendorAggregate(items);
    this.logger.info({
      event: 'load_aggregate',
      vendorId,
      itemCount: items.length,
      hasProfile: Boolean(aggregate.profile),
      hasOwner: Boolean(aggregate.owner),
      hasAddress: Boolean(aggregate.address),
      hasBank: Boolean(aggregate.bank),
      branchCount: aggregate.branches.length,
      documentCount: aggregate.documents.length,
      documentTypes: aggregate.documents.map((item) => item.documentType),
    });
    return aggregate;
  }

  private toOnboardingResponse(
    aggregate: VendorAggregate,
    extras?: {
      documentUploadUrl?: string;
      documentId?: string;
      expiresIn?: number;
    },
  ): OnboardingResponse {
    const profile = aggregate.profile;
    if (!profile) {
      this.logger.info({
        event: 'to_onboarding_response_missing_profile',
        hasOwner: Boolean(aggregate.owner),
        hasAddress: Boolean(aggregate.address),
        hasBank: Boolean(aggregate.bank),
        branchCount: aggregate.branches.length,
        documentCount: aggregate.documents.length,
      });
      throw new NotFoundError('Vendor not found');
    }

    const state = computeStateFromAggregate(aggregate);
    this.logger.info({
      event: 'to_onboarding_response',
      vendorId: profile.vendorId,
      status: state.status,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      includeBusinessInfo: Boolean(aggregate.profile?.businessName),
      includeOwner: Boolean(aggregate.owner),
      includeAddress: Boolean(aggregate.address),
      branchCount: aggregate.branches.length,
      documentCount: aggregate.documents.length,
      includeBank: Boolean(aggregate.bank),
      includeUploadUrl: Boolean(extras?.documentUploadUrl && extras.documentId),
    });
    const documents = aggregate.documents.map((item) =>
      DocumentsMapper.toDomain(item, {
        uploadUrl:
          extras?.documentId === item.documentId
            ? extras.documentUploadUrl
            : undefined,
        expiresIn:
          extras?.documentId === item.documentId ? extras.expiresIn : undefined,
      }),
    );

    return {
      vendorId: profile.vendorId,
      status: state.status,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      applicationId: profile.applicationId,
      sections: {
        ...(aggregate.profile
          ? {
              BUSINESS_INFO: aggregate.profile.businessName
                ? {
                     businessType: aggregate.profile. businessType ?? 'BUSINESS',
                    businessName: aggregate.profile.businessName,
                    contactName: aggregate.profile.contactName ?? '',
                    phoneNumber: aggregate.profile.phoneNumber ?? '',
                    email: aggregate.profile.email,
                    description: aggregate.profile.description,
                    gstNumber: aggregate.profile.gstNumber,
                    panNumber: aggregate.profile.panNumber,
                    profileImageUrl: aggregate.profile.profileImageUrl,
                  }
                : undefined,
            }
          : {}),
        OWNER_DETAILS: aggregate.owner
          ? OwnerMapper.toDomain(aggregate.owner)
          : undefined,
        ADDRESS: aggregate.address
          ? VendorsMapper.toAddressDomain(aggregate.address)
          : undefined,
        BRANCH: aggregate.branches.map((item) => BranchesMapper.toDomain(item)),
        DOCUMENTS: documents,
        BANK_DETAILS: aggregate.bank
          ? BankDetailsMapper.toDomain(aggregate.bank)
          : undefined,
      },
    };
  }

  private async persistProfileAndSection(
    profile: VendorDdbItem,
    aggregate: VendorAggregate,
    sectionItems: Array<Record<string, unknown>> = [],
  ): Promise<OnboardingResponse> {
    const previousOnboardingStatus = profile.onboardingStatus;
    aggregate.profile = profile;
    const state = computeStateFromAggregate(aggregate);
    const correlationId = getLoggerContext()?.correlationId;
    const mintedApplicationId =
      !profile.applicationId && state.status === ONBOARDING_STATUS.PENDING_REVIEW;
    const applicationId = profile.applicationId ?? (mintedApplicationId ? randomUUID() : undefined);
    const email = profile.email ?? aggregate.owner?.email;
    this.logger.info({
      event: 'persist_profile_and_section_state',
      vendorId: profile.vendorId,
      previousOnboardingStatus,
      computedStatus: state.status,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      hasExistingApplicationId: Boolean(profile.applicationId),
      mintedApplicationId,
      emailSource: profile.email ? 'profile' : aggregate.owner?.email ? 'owner' : 'none',
      hasCorrelationId: Boolean(correlationId && correlationId !== 'unknown'),
      sectionItemCount: sectionItems.length,
    });

    let updatedProfile = VendorsMapper.applyOnboardingState(profile, {
      onboardingStatus: state.status,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      primaryBranchId: profile.primaryBranchId,
      addressCity: aggregate.address?.city,
      addressPostalCode: aggregate.address?.postalCode,
      applicationId,
      email,
      meta:
        correlationId && correlationId !== 'unknown'
          ? { correlationId }
          : undefined,
    });
    // Verification becomes available when its persisted email and template
    // data are complete; bank/address/onboarding submission remain separate.
    const becameVerificationReady = Boolean(
      !profile.emailVerificationRequestId &&
      hasValidRegisteredEmail(updatedProfile.email) &&
      updatedProfile.contactName?.trim() &&
      updatedProfile.businessName?.trim(),
    );
    const alreadyVerified = Boolean(updatedProfile.emailVerifiedAt);
    const alreadyRequested = Boolean(updatedProfile.emailVerificationRequestId);
    this.logger.info({
      event: 'persist_profile_and_section_verification_check',
      vendorId: updatedProfile.vendorId,
      becameVerificationReady,
      alreadyVerified,
      alreadyRequested,
      hasValidEmail: hasValidRegisteredEmail(updatedProfile.email),
      hasContactName: Boolean(updatedProfile.contactName?.trim()),
      hasBusinessName: Boolean(updatedProfile.businessName?.trim()),
      willMintVerification: becameVerificationReady && !alreadyVerified && !alreadyRequested,
    });
    if (becameVerificationReady && !alreadyVerified && !alreadyRequested) {
      // Persist the request with the transition. Stream retries then reuse this
      // immutable credential instead of minting a replacement.
      const token = generateVendorEmailVerificationOtp(updatedProfile.vendorId);
      const requestedAt = new Date().toISOString();
      updatedProfile = {
        ...updatedProfile,
        emailVerificationRequestId: randomUUID(),
        emailVerificationOtp: token,
        emailVerificationTokenHash: hashVendorEmailVerificationToken(token),
        emailVerificationEmail: updatedProfile.email,
        emailVerificationExpiryMinutes: VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
        emailVerificationRequestedAt: requestedAt,
        emailVerificationExpiresAt: new Date(
          Date.parse(requestedAt) + VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES * 60_000,
        ).toISOString(),
        emailVerificationDispatchPending: true,
      };
    }
    aggregate.profile = updatedProfile;

    try {
      await this.vendorsRepository.putSection(updatedProfile, sectionItems);
      this.logger.info({
        event: 'persist_profile_and_section_write_succeeded',
        vendorId: updatedProfile.vendorId,
        onboardingStatus: updatedProfile.onboardingStatus,
        sectionItemCount: sectionItems.length,
      });
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        this.logger.info({
          event: 'persist_profile_and_section_write_conflict',
          vendorId: updatedProfile.vendorId,
        });
        throw new NotFoundError('Vendor not found');
      }
      this.logger.info({
        event: 'persist_profile_and_section_write_failed',
        vendorId: updatedProfile.vendorId,
        errorName: err instanceof Error ? err.name : 'unknown',
      });
      throw err;
    }

    const transitionedToPendingReview =
      previousOnboardingStatus !== ONBOARDING_STATUS.PENDING_REVIEW &&
      updatedProfile.onboardingStatus === ONBOARDING_STATUS.PENDING_REVIEW;
    this.logger.info({
      event: 'persist_profile_and_section_review_transition',
      vendorId: updatedProfile.vendorId,
      previousOnboardingStatus,
      onboardingStatus: updatedProfile.onboardingStatus,
      transitionedToPendingReview,
    });
    if (transitionedToPendingReview) {
      this.logger.info({
        event: 'vendor_onboarding_submitted',
        vendorId: updatedProfile.vendorId,
        applicationId: updatedProfile.applicationId,
        correlationId,
        onboardingStatus: updatedProfile.onboardingStatus,
      });
    }

    return this.toOnboardingResponse(aggregate);
  }

  async getvendoronboarding(request: LambdaRequest): Promise<OnboardingResponse> {
    const vendorId = getVendorId(request); 
     

    this.logger.info({ event: 'getvendoronboarding_start', vendorId });

    const aggregate = await this.loadAggregate(vendorId);
    const response = this.toOnboardingResponse(aggregate);

    this.logger.info({
      event: 'getvendoronboarding_success',
      vendorId,
      status: response.status,
    });

    return response;
  }

  async submitvendorforreview(
    request: LambdaRequest,
  ): Promise<OnboardingResponse> {
    const vendorId = getVendorId(request);
    const profile = await this.requireVendor(vendorId);
     

    this.logger.info({ event: 'submitvendorforreview_start', vendorId });

    const aggregate = await this.loadAggregate(vendorId);

    if (
      profile.onboardingStatus === ONBOARDING_STATUS.PENDING_REVIEW ||
      profile.onboardingStatus === ONBOARDING_STATUS.COMPLETED
    ) {
      this.logger.info({
        event: 'submitvendorforreview_idempotent',
        vendorId,
        applicationId: profile.applicationId,
      });
      return this.toOnboardingResponse(aggregate);
    }

    // const documentGaps = requiredDocumentGaps(aggregate.documents);
    // if (documentGaps.missing.length > 0 || documentGaps.notUploaded.length > 0) {
    //   const parts = [
    //     ...documentGaps.missing.map((type) => `${type} is missing`),
    //     ...documentGaps.notUploaded.map((type) => `${type} is still uploading`),
    //   ];
    //   throw new ValidationError(
    //     `Required onboarding documents are not ready: ${parts.join(', ')}`,
    //     parts.map((message) => ({ field: 'documents', message })),
    //   );
    // }

    const state = computeStateFromAggregate(aggregate);

    if (state.status !== ONBOARDING_STATUS.PENDING_REVIEW) {
      const missing = ONBOARDING_SECTION_ORDER.filter(
        (section) => !state.completedSections.includes(section),
      );
      throw new ConflictError(
        `Vendor onboarding is incomplete: ${missing.join(', ')}`,
      );
    }

    const response = await this.persistProfileAndSection(profile, aggregate);

    this.logger.info({
      event: 'submitvendorforreview_success',
      vendorId,
      applicationId: response.applicationId,
    });

    return response;
  }

  async updatevendoronboarding(
    request: LambdaRequest,
  ): Promise<OnboardingResponse> {
    const vendorId = getVendorId(request);
    const profile = await this.requireVendor(vendorId);
     
    const body = request.body as {
      section: OnboardingSection;
      data: unknown;
    };

    this.logger.info({
      event: 'updatevendoronboarding_start',
      vendorId,
      section: body.section,
    });

    const aggregate = await this.loadAggregate(vendorId);
    aggregate.profile = profile;

    let response: OnboardingResponse;

    switch (body.section) {
      case ONBOARDING_SECTION.BUSINESS_INFO_AND_OWNER: {
        const data = body.data as BusinessInfoAndOwnerData;
        const profile = this.saveBusinessInfo(aggregate, data.businessInfo);
        const owner = this.saveOwnerDetails(aggregate, data.ownerDetails);
        response = await this.persistProfileAndSection(profile, aggregate, [
          owner as unknown as Record<string, unknown>,
        ]);
        break;
      }
      case ONBOARDING_SECTION.SERVICE_LOCATION_AND_COVERAGE: {
        const data = body.data as ServiceLocationAndCoverageData;
        const address = this.saveAddress(aggregate, data.address);
        const branch = await this.saveBranch(aggregate, data.branch);
        response = await this.persistProfileAndSection(
          aggregate.profile!,
          aggregate,
          [
            address as unknown as Record<string, unknown>,
            branch as unknown as Record<string, unknown>,
          ],
        );
        break;
      }
      case ONBOARDING_SECTION.BUSINESS_VERIFICATION:
        response = await this.saveDocument(
          aggregate,
          body.data as DocumentsData,
        );
        break;
      case ONBOARDING_SECTION.BANK_AND_PAYOUT_DETAILS:
        response = await this.saveBank(
          aggregate,
          body.data as BankDetailsData,
        );
        break;
      default:
        throw new NotFoundError('Unknown onboarding section');
    }

    this.logger.info({
      event: 'updatevendoronboarding_success',
      vendorId,
      section: body.section,
      status: response.status,
    });

    return response;
  }

  private saveBusinessInfo(
    aggregate: VendorAggregate,
    data: BusinessInfoData,
  ): VendorDdbItem {
    const profile = VendorsMapper.applyBusinessInfo(aggregate.profile!, data);
    aggregate.profile = profile;
    return profile;
  }

  private saveOwnerDetails(
    aggregate: VendorAggregate,
    data: OwnerDetailsData,
  ) {
    const ownerUserId = aggregate.profile?.ownerUserId?.trim();
    if (!ownerUserId) {
      throw new ValidationError('Vendor owner is not set');
    }
    if (data.userId && data.userId !== ownerUserId) {
      this.logger.info({
        event: 'owner_details_user_id_ignored',
        vendorId: aggregate.profile?.vendorId,
      });
    }
    const owner = OwnerMapper.toDdbItem(
      aggregate.profile!.vendorId,
      {
        userId: ownerUserId,
        fullName: data.fullName,
        designation: data.designation,
        phoneNumber: data.phoneNumber,
        email: data.email,
      },
      { createdAt: aggregate.owner?.createdAt },
    );
    aggregate.owner = owner;
    return owner;
  }

  private saveAddress(
    aggregate: VendorAggregate,
    data: AddressData,
  ): VendorAddressDdbItem {
    const address: VendorAddressDdbItem = VendorsMapper.toAddressDdbItem(
      aggregate.profile!.vendorId,
      data,
      { createdAt: aggregate.address?.createdAt },
    );
    aggregate.address = address;
    return address;
  }

  private async saveBranch(
    aggregate: VendorAggregate,
    data: BranchData,
  ): Promise<VendorBranchDdbItem> {
    const profile = aggregate.profile!;
    const existingId =
      data.branchId ??
      profile.primaryBranchId ??
      aggregate.branches.find((item) => item.isPrimary)?.branchId;

    let branch: VendorBranchDdbItem;

    if (existingId) {
      const current =
        aggregate.branches.find((item) => item.branchId === existingId) ??
        (await this.branchesRepository.getBranch(profile.vendorId, existingId));

      if (!current) {
        throw new NotFoundError('Branch not found');
      }

      branch = BranchesMapper.applyUpdate(current, data);
    } else {
      const branchId = randomUUID();
      branch = BranchesMapper.toDdbItem(data, profile.vendorId, branchId, {
        isPrimary: true,
      });
      profile.primaryBranchId = branchId;
    }

    const nextBranches = [
      ...aggregate.branches.filter((item) => item.branchId !== branch.branchId),
      branch,
    ];
    aggregate.branches = nextBranches;
    aggregate.profile = profile;
    return branch;
  }

  private async saveDocument(
    aggregate: VendorAggregate,
    data: DocumentsData,
  ): Promise<OnboardingResponse> {
    const profile = aggregate.profile!;
    assertDocumentsMutable(profile.onboardingStatus);
    const parsed = parseDocumentUploadRequest(data);
    const existing =
      aggregate.documents.find((item) => item.documentType === parsed.documentType) ??
      (await this.documentsRepository.findByDocumentType(
        profile.vendorId,
        parsed.documentType,
      ));

    const documentId = existing?.documentId ?? randomUUID();
    const objectKey = createDocumentObjectKey(
      profile.vendorId,
      documentId,
      parsed.contentType,
    );
    const upload = await this.documentStorage.createUploadUrl({
      objectKey,
      contentType: parsed.contentType,
      fileSize: parsed.fileSize,
    });
    if (upload.objectKey !== objectKey) {
      throw new ValidationError('Document object key could not be created');
    }

    const { item: document, orphanObjectKey } = DocumentsMapper.toPendingUploadItem({
      request: parsed,
      vendorId: profile.vendorId,
      documentId,
      bucket: upload.bucket,
      objectKey,
      existing,
    });

    if (orphanObjectKey) {
      await this.documentStorage.deleteObject({
        bucket: existing?.bucket || upload.bucket,
        objectKey: orphanObjectKey,
      });
    }

    aggregate.documents = [
      ...aggregate.documents.filter((item) => item.documentId !== documentId),
      document,
    ];

    await this.persistProfileAndSection(profile, aggregate, [
      document as unknown as Record<string, unknown>,
    ]);

    return this.toOnboardingResponse(aggregate, {
      documentId,
      documentUploadUrl: upload.uploadUrl,
      expiresIn: upload.expiresIn,
    });
  }

  private async saveBank(
    aggregate: VendorAggregate,
    data: BankDetailsData,
  ): Promise<OnboardingResponse> {
    const bank: VendorBankDdbItem = BankDetailsMapper.toDdbItem(
      aggregate.profile!.vendorId,
      data,
      { createdAt: aggregate.bank?.createdAt },
    );
    aggregate.bank = bank;
    return this.persistProfileAndSection(aggregate.profile!, aggregate, [
      bank as unknown as Record<string, unknown>,
    ]);
  }

  toVendorView(profile: VendorDdbItem, address?: VendorAddressDdbItem | null): Vendor {
    return VendorsMapper.toDomain(profile, address);
  }
}

let service: OnboardingService;

export function getOnboardingService() {
  if (!service) {
    service = new OnboardingService();
  }
  return service;
}
