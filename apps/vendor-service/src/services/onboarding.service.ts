import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConditionalWriteConflictError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createLogger, createChildLogger, getLoggerContext } from '@api-hub/observability';

import {
  AddressData,
  BankDetailsData,
  BranchData,
  BusinessInfoData,
  DocumentsData,
  OnboardingResponse,
  OnboardingSection,
  OwnerDetailsData,
  Vendor,
} from '../types/api-types';
import {
  VendorAddressDdbItem,
  VendorBankDdbItem,
  VendorBranchDdbItem,
  VendorDdbItem,
} from '../types/repository.types';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import {
  BranchesRepository,
  getBranchesRepository,
} from '../repositories/branches.repository';
import {
  DocumentsRepository,
  getDocumentsRepository,
} from '../repositories/documents.repository';
import { VendorsMapper } from '../mappers/vendors.mapper';
import { OwnerMapper } from '../mappers/owner.mapper';
import {
  BankDetailsMapper,
  BranchesMapper,
} from '../mappers/bank-and-branches.mapper';
import { DocumentsMapper } from '../mappers/documents.mapper';
import {
  DocumentStorage,
  getDocumentStorage,
} from '../storage/document-storage';
import {
  ONBOARDING_SECTION,
  ONBOARDING_SECTION_ORDER,
  ONBOARDING_STATUS,
} from '../domain/onboarding';
import {
  generateVendorEmailVerificationOtp,
  hashVendorEmailVerificationToken,
  hasValidRegisteredEmail,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
} from '../domain/email-verification';
import {
  assertDocumentsMutable,
  createDocumentObjectKey,
  parseDocumentUploadRequest,
  requiredDocumentGaps,
} from '../domain/document-upload';
import {
  computeStateFromAggregate,
  toVendorAggregate,
  VendorAggregate,
} from '../domain/vendor-aggregate';
import {
  assertVendorAccess,
  getVendorId,
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
      throw new NotFoundError('Vendor not found');
    }
    return item;
  }

  private async loadAggregate(vendorId: string): Promise<VendorAggregate> {
    const items = await this.vendorsRepository.queryVendorItems(vendorId);
    return toVendorAggregate(items);
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
      throw new NotFoundError('Vendor not found');
    }

    const state = computeStateFromAggregate(aggregate);
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
                    vendorType: aggregate.profile.vendorType ?? 'BUSINESS',
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
    sectionItem?: Record<string, unknown>,
  ): Promise<OnboardingResponse> {
    const previousOnboardingStatus = profile.onboardingStatus;
    aggregate.profile = profile;
    const state = computeStateFromAggregate(aggregate);
    const correlationId = getLoggerContext()?.correlationId;
    const applicationId =
      profile.applicationId ??
      (state.status === ONBOARDING_STATUS.PENDING_REVIEW
        ? randomUUID()
        : undefined);
    const email = profile.email ?? aggregate.owner?.email;

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
    if (
      becameVerificationReady &&
      !updatedProfile.emailVerifiedAt &&
      !updatedProfile.emailVerificationRequestId
    ) {
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
      await this.vendorsRepository.putSection(updatedProfile, sectionItem);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new NotFoundError('Vendor not found');
      }
      throw err;
    }

    if (
      previousOnboardingStatus !== ONBOARDING_STATUS.PENDING_REVIEW &&
      updatedProfile.onboardingStatus === ONBOARDING_STATUS.PENDING_REVIEW
    ) {
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
    const profile = await this.requireVendor(vendorId);
    assertVendorAccess(request, profile);

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
    assertVendorAccess(request, profile);

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

    const documentGaps = requiredDocumentGaps(aggregate.documents);
    if (documentGaps.missing.length > 0 || documentGaps.notUploaded.length > 0) {
      const parts = [
        ...documentGaps.missing.map((type) => `${type} is missing`),
        ...documentGaps.notUploaded.map((type) => `${type} is still uploading`),
      ];
      throw new ValidationError(
        `Required onboarding documents are not ready: ${parts.join(', ')}`,
        parts.map((message) => ({ field: 'documents', message })),
      );
    }

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
    assertVendorAccess(request, profile);
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
      case ONBOARDING_SECTION.BUSINESS_INFO:
        response = await this.saveBusinessInfo(
          aggregate,
          body.data as BusinessInfoData,
        );
        break;
      case ONBOARDING_SECTION.OWNER_DETAILS:
        response = await this.saveOwnerDetails(
          aggregate,
          body.data as OwnerDetailsData,
        );
        break;
      case ONBOARDING_SECTION.ADDRESS:
        response = await this.saveAddress(aggregate, body.data as AddressData);
        break;
      case ONBOARDING_SECTION.BRANCH:
        response = await this.saveBranch(aggregate, body.data as BranchData);
        break;
      case ONBOARDING_SECTION.DOCUMENTS:
        response = await this.saveDocument(
          aggregate,
          body.data as DocumentsData,
        );
        break;
      case ONBOARDING_SECTION.BANK_DETAILS:
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

  private async saveBusinessInfo(
    aggregate: VendorAggregate,
    data: BusinessInfoData,
  ): Promise<OnboardingResponse> {
    const profile = VendorsMapper.applyBusinessInfo(aggregate.profile!, data);
    aggregate.profile = profile;
    return this.persistProfileAndSection(profile, aggregate);
  }

  private async saveOwnerDetails(
    aggregate: VendorAggregate,
    data: OwnerDetailsData,
  ): Promise<OnboardingResponse> {
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
    return this.persistProfileAndSection(
      aggregate.profile!,
      aggregate,
      owner as unknown as Record<string, unknown>,
    );
  }

  private async saveAddress(
    aggregate: VendorAggregate,
    data: AddressData,
  ): Promise<OnboardingResponse> {
    const address: VendorAddressDdbItem = VendorsMapper.toAddressDdbItem(
      aggregate.profile!.vendorId,
      data,
      { createdAt: aggregate.address?.createdAt },
    );
    aggregate.address = address;
    return this.persistProfileAndSection(
      aggregate.profile!,
      aggregate,
      address as unknown as Record<string, unknown>,
    );
  }

  private async saveBranch(
    aggregate: VendorAggregate,
    data: BranchData,
  ): Promise<OnboardingResponse> {
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

    return this.persistProfileAndSection(
      profile,
      aggregate,
      branch as unknown as Record<string, unknown>,
    );
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

    await this.persistProfileAndSection(
      profile,
      aggregate,
      document as unknown as Record<string, unknown>,
    );

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
    return this.persistProfileAndSection(
      aggregate.profile!,
      aggregate,
      bank as unknown as Record<string, unknown>,
    );
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
