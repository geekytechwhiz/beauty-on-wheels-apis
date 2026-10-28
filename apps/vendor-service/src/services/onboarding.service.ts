import { ConditionalWriteConflictError, ConflictError, LambdaRequest, NotFoundError, ValidationError } from '@api-hub/utils';
import { randomUUID } from 'crypto';

import { ONBOARDING_SECTION_ORDER, ONBOARDING_STATUS } from '../domain/onboarding';
import { computeStateFromAggregate, toVendorAggregate, VendorAggregate } from '../domain/vendor-aggregate';
import { BankDetailsMapper } from '../mappers/bank-and-branches.mapper';
import { CommunitiesMapper } from '../mappers/communities.mapper';
import { DocumentsMapper } from '../mappers/documents.mapper';
import { OwnerMapper } from '../mappers/owner.mapper';
import { CommunitiesRepository, getCommunitiesRepository } from '../repositories/communities.repository';
import { getVendorsRepository, VendorsRepository } from '../repositories/vendors.repository';
import { UpdateOnboardingRequest } from '../schemas/onboarding.schema';
import { OnboardingResponse } from '../types/api-types';
import { VendorBankDdbItem, VendorDdbItem } from '../types/repository.types';
import { assertVendorAccess, getVendorId } from '../utils/helpers';
import { MAX_VENDOR_COMMUNITIES, isCommunityId, normalizeCommunityId, uniqueCommunityIds } from '../domain/community';
import { generateVendorEmailVerificationOtp, hashVendorEmailVerificationToken, hasValidRegisteredEmail, VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES } from '../domain/email-verification';

type ProfilePatch = NonNullable<UpdateOnboardingRequest['sections']['BUSINESS_INFO']>;
type BankPatch = NonNullable<UpdateOnboardingRequest['sections']['BANK_DETAILS']>;

export class OnboardingService {
  constructor(
    private readonly vendors: VendorsRepository = getVendorsRepository(),
    private readonly communities: CommunitiesRepository = getCommunitiesRepository(),
  ) {}

  private async requireAccessibleVendor(request: LambdaRequest): Promise<VendorDdbItem> {
    const vendor = await this.vendors.getVendorById(getVendorId(request));
    if (!vendor) throw new NotFoundError('Vendor not found');
    assertVendorAccess(request, vendor);
    return vendor;
  }

  private async aggregate(vendorId: string): Promise<VendorAggregate> {
    return toVendorAggregate(await this.vendors.queryVendorItems(vendorId));
  }

  private response(aggregate: VendorAggregate): OnboardingResponse {
    const profile = aggregate.profile;
    if (!profile) throw new NotFoundError('Vendor not found');
    const computed = computeStateFromAggregate(aggregate);
    const persistedCompleted = profile.completedSections ?? computed.completedSections;
    const completed = profile.onboardingStatus === ONBOARDING_STATUS.PENDING_REVIEW ||
      profile.onboardingStatus === ONBOARDING_STATUS.AWAITING_EMAIL_VERIFICATION
      ? computed.completedSections : persistedCompleted;
    const incomplete = ONBOARDING_SECTION_ORDER.filter((section) => !completed.includes(section));
    return {
      vendorId: profile.vendorId,
      status: profile.onboardingStatus,
      currentSection: profile.currentSection,
      completedSections: completed,
      applicationId: profile.applicationId,
      revision: profile.revision ?? 0,
      lastVisitedStep: profile.lastVisitedStep,
      requiredSections: ONBOARDING_SECTION_ORDER,
      incompleteSections: incomplete,
      recommendedNextStep: incomplete[0],
      sections: {
        BUSINESS_INFO: profile.businessName ? {
          businessType: profile.businessType ?? 'BUSINESS', businessName: profile.businessName,
          contactName: profile.contactName ?? '', phoneNumber: profile.phoneNumber ?? '', email: profile.email,
          description: profile.description, gstNumber: profile.gstNumber, panNumber: profile.panNumber,
          profileImageUrl: profile.profileImageUrl,
        } : undefined,
        OWNER_DETAILS: aggregate.owner ? OwnerMapper.toDomain(aggregate.owner) : undefined,
        DOCUMENTS: aggregate.documents.map((document) => DocumentsMapper.toDomain(document)),
        BANK_DETAILS: aggregate.bank ? BankDetailsMapper.toDomain(aggregate.bank) : undefined,
        COMMUNITIES: (profile.communityIds ?? []).map((communityId) => ({ communityId })),
      } as OnboardingResponse['sections'],
    };
  }

  async getvendoronboarding(request: LambdaRequest): Promise<OnboardingResponse> {
    const vendor = await this.requireAccessibleVendor(request);
    return this.response(await this.aggregate(vendor.vendorId));
  }

  private assertDraftMutable(profile: VendorDdbItem): void {
    if (profile.onboardingStatus === ONBOARDING_STATUS.DRAFT || profile.onboardingStatus === ONBOARDING_STATUS.IN_PROGRESS || profile.onboardingStatus === ONBOARDING_STATUS.CHANGES_REQUESTED) return;
    throw new ConflictError(`Onboarding cannot be changed while status is ${profile.onboardingStatus}`);
  }

  async updatevendoronboarding(request: LambdaRequest): Promise<OnboardingResponse> {
    const profile = await this.requireAccessibleVendor(request);
    this.assertDraftMutable(profile);
    const body = request.body as UpdateOnboardingRequest;
    const actualRevision = profile.revision ?? 0;
    if (body.revision !== actualRevision) throw new ConflictError('Onboarding has changed; reload before saving');

    const aggregate = await this.aggregate(profile.vendorId);
    aggregate.profile = profile;
    const puts: Array<Record<string, unknown>> = [];
    const deletes: Array<{ PK: string; SK: string }> = [];
    if (body.sections.BUSINESS_INFO) aggregate.profile = this.applyBusinessInfo(profile, body.sections.BUSINESS_INFO);
    if (body.sections.BANK_DETAILS) {
      const bank = this.applyBank(profile.vendorId, aggregate.bank, body.sections.BANK_DETAILS);
      aggregate.bank = bank;
      puts.push(bank as unknown as Record<string, unknown>);
    }
    if (body.sections.COMMUNITIES) {
      const replacement = await this.replaceCommunities(aggregate, body.sections.COMMUNITIES.communityIds, request);
      puts.push(...replacement.puts);
      deletes.push(...replacement.deletes);
    }

    const computed = computeStateFromAggregate(aggregate);
    const next: VendorDdbItem = {
      ...aggregate.profile!,
      onboardingStatus: computed.status,
      currentSection: computed.currentSection,
      completedSections: computed.completedSections,
      lastVisitedStep: body.lastVisitedStep ?? profile.lastVisitedStep,
      revision: actualRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    aggregate.profile = next;
    try {
      await this.vendors.transactVendorProfile({ profile: next, expectedRevision: actualRevision, puts: puts.map((item) => ({ item })), deletes });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) throw new ConflictError('Onboarding has changed; reload before saving');
      throw error;
    }
    return this.response(aggregate);
  }

  private applyBusinessInfo(profile: VendorDdbItem, patch: ProfilePatch): VendorDdbItem {
    const nullable = <T>(key: keyof ProfilePatch, old: T | undefined): T | undefined =>
      Object.prototype.hasOwnProperty.call(patch, key) ? (patch[key] as T | null | undefined) ?? undefined : old;
    return {
      ...profile,
      businessType: patch.businessType ?? profile.businessType,
      businessName: patch.businessName ?? profile.businessName,
      contactName: patch.contactName ?? profile.contactName,
      phoneNumber: patch.phoneNumber ?? profile.phoneNumber,
      email: nullable('email', profile.email),
      description: nullable('description', profile.description),
      gstNumber: nullable('gstNumber', profile.gstNumber),
      panNumber: nullable('panNumber', profile.panNumber),
      profileImageUrl: nullable('profileImageUrl', profile.profileImageUrl),
    };
  }

  private applyBank(vendorId: string, existing: VendorBankDdbItem | undefined, patch: BankPatch): VendorBankDdbItem {
    const set = <T>(key: keyof BankPatch, old: T | undefined): T | undefined =>
      Object.prototype.hasOwnProperty.call(patch, key) ? (patch[key] as T | null | undefined) ?? undefined : old;
    const timestamp = new Date().toISOString();
    return {
      PK: existing?.PK ?? `VENDOR#${vendorId}`, SK: existing?.SK ?? 'BANK', vendorId,
      accountHolderName: set('accountHolderName', existing?.accountHolderName),
      accountNumber: set('accountNumber', existing?.accountNumber), ifscCode: set('ifscCode', existing?.ifscCode),
      bankName: set('bankName', existing?.bankName), branchName: set('branchName', existing?.branchName),
      accountType: set('accountType', existing?.accountType), createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp, entityType: 'VendorBank',
    };
  }

  private async replaceCommunities(aggregate: VendorAggregate, requested: string[], request: LambdaRequest) {
    const ids = uniqueCommunityIds(requested.map(normalizeCommunityId));
    if (ids.some((id) => !isCommunityId(id))) throw new ValidationError('Invalid communityId');
    if (ids.length > MAX_VENDOR_COMMUNITIES) throw new ValidationError(`A vendor can belong to at most ${MAX_VENDOR_COMMUNITIES} communities`);
    for (const communityId of ids) {
      if (!await this.communities.getActiveCommunity(communityId)) throw new ValidationError(`Community ${communityId} is unavailable`);
    }
    const current = await this.communities.listByVendor(aggregate.profile!.vendorId);
    const desired = new Set(ids);
    const currentIds = new Set(current.map((item) => item.communityId));
    const now = new Date().toISOString();
    const actor = String(request.context.userContext?.userId ?? aggregate.profile!.ownerUserId);
    aggregate.profile = { ...aggregate.profile!, communityIds: ids };
    return {
      puts: ids.filter((id) => !currentIds.has(id)).map((communityId) => CommunitiesMapper.toItem({ vendor: aggregate.profile!, communityId, assignedBy: actor, assignedAt: now }) as unknown as Record<string, unknown>),
      deletes: current.filter((item) => !desired.has(item.communityId)).map((item) => ({ PK: item.PK, SK: item.SK })),
    };
  }

  async submitvendorforreview(request: LambdaRequest): Promise<OnboardingResponse> {
    const profile = await this.requireAccessibleVendor(request);
    if (profile.onboardingStatus === ONBOARDING_STATUS.PENDING_REVIEW || profile.onboardingStatus === ONBOARDING_STATUS.AWAITING_EMAIL_VERIFICATION) return this.response(await this.aggregate(profile.vendorId));
    this.assertDraftMutable(profile);
    const aggregate = await this.aggregate(profile.vendorId);
    const computed = computeStateFromAggregate(aggregate);
    if (computed.completedSections.length !== ONBOARDING_SECTION_ORDER.length) {
      const missing = ONBOARDING_SECTION_ORDER.filter((item) => !computed.completedSections.includes(item));
      throw new ValidationError(`Vendor onboarding is incomplete: ${missing.join(', ')}`);
    }
    const revision = profile.revision ?? 0;
    const now = new Date();
    if (!profile.emailVerifiedAt && !hasValidRegisteredEmail(profile.email)) throw new ValidationError('A verified business email is required before submission');
    const token = !profile.emailVerifiedAt ? generateVendorEmailVerificationOtp(profile.vendorId) : undefined;
    const next: VendorDdbItem = {
      ...profile,
      onboardingStatus: profile.emailVerifiedAt ? ONBOARDING_STATUS.PENDING_REVIEW : ONBOARDING_STATUS.AWAITING_EMAIL_VERIFICATION,
      completedSections: computed.completedSections, currentSection: computed.currentSection,
      revision: revision + 1, updatedAt: now.toISOString(),
      ...(token ? {
        emailVerificationRequestId: randomUUID(), emailVerificationOtp: token,
        emailVerificationTokenHash: hashVendorEmailVerificationToken(token), emailVerificationEmail: profile.email,
        emailVerificationExpiryMinutes: VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
        emailVerificationRequestedAt: now.toISOString(),
        emailVerificationExpiresAt: new Date(now.getTime() + VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES * 60_000).toISOString(),
        emailVerificationDispatchPending: true,
      } : {}),
    };
    aggregate.profile = next;
    try { await this.vendors.transactVendorProfile({ profile: next, expectedRevision: revision }); }
    catch (error) { if (error instanceof ConditionalWriteConflictError) throw new ConflictError('Onboarding has changed; reload before submitting'); throw error; }
    return this.response(aggregate);
  }
}

let service: OnboardingService;
export function getOnboardingService() { if (!service) service = new OnboardingService(); return service; }
