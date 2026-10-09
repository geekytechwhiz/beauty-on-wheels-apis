import { randomUUID } from 'crypto';
import {
  ConflictError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import {
  EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS,
  generateVendorEmailVerificationOtp,
  hasValidRegisteredEmail,
  hashVendorEmailVerificationToken,
  matchesVendorEmailVerificationToken,
  vendorIdFromVerificationToken,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
} from '../domain/email-verification';
import { ONBOARDING_SECTION_ORDER, ONBOARDING_STATUS } from '../domain/onboarding';
import { VendorsRepository, getVendorsRepository } from '../repositories/vendors.repository';
import { VendorDdbItem } from '../types/repository.types';
import { assertVendorAccess, getVendorId } from '../utils/helpers';
import { RateLimitError } from '../errors';

const RESEND_COOLDOWN_MS = 60_000;

export type VerifyEmailResponse = {
  vendorId: string;
  emailVerified: true;
  onboardingStatus: 'PENDING_REVIEW';
};

function expiresAt(profile: VendorDdbItem): number {
  if (profile.emailVerificationExpiresAt) return Date.parse(profile.emailVerificationExpiresAt);
  if (!profile.emailVerificationRequestedAt) return Number.NaN;
  return Date.parse(profile.emailVerificationRequestedAt) +
    (profile.emailVerificationExpiryMinutes ?? VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES) * 60_000;
}

function verificationResponse(profile: VendorDdbItem): VerifyEmailResponse {
  return {
    vendorId: profile.vendorId,
    emailVerified: true,
    onboardingStatus: 'PENDING_REVIEW',
  };
}

export class EmailVerificationService {
  constructor(
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private assertEligible(profile: VendorDdbItem): void {
    const completed = new Set(profile.completedSections);
    if (
      profile.status !== EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS ||
      !ONBOARDING_SECTION_ORDER.every((section) => completed.has(section)) ||
      !hasValidRegisteredEmail(profile.email)
    ) {
      throw new ValidationError('Email verification is not available for this vendor');
    }
  }

  async verify(request: LambdaRequest): Promise<VerifyEmailResponse> {
    const token = (request.body as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !token.trim()) {
      throw new ValidationError('Invalid verification link');
    }

    // Tokens are opaque, so locate the candidate profile through the request
    // identity embedded by the client link. The email service already sends the
    // opaque token; clients include vendorId as a link query parameter.
    const vendorId = vendorIdFromVerificationToken(token) ?? String(request.params?.vendorId ?? request.pathParameters?.vendorId ?? '');
    if (!vendorId) {
      throw new ValidationError('Invalid verification link');
    }
    const profile = await this.vendorsRepository.getVendorById(vendorId);
    if (!profile || !matchesVendorEmailVerificationToken(token, profile.emailVerificationTokenHash, profile.emailVerificationOtp)) {
      throw new ValidationError('Invalid verification link');
    }
    // A consumed link is deterministic and has no further side effects, even
    // after an administrator has advanced the vendor lifecycle.
    if (profile.emailVerificationConsumedAt && profile.emailVerifiedAt) {
      return verificationResponse(profile);
    }
    this.assertEligible(profile);
    if (profile.emailVerificationEmail && profile.emailVerificationEmail !== profile.email) {
      throw new ValidationError('Invalid verification link');
    }
    if (profile.emailVerificationRevokedAt) {
      throw new ValidationError('Invalid verification link');
    }
    if (this.now().getTime() > expiresAt(profile)) {
      throw new ValidationError('Verification link has expired');
    }
    if (profile.emailVerifiedAt) {
      return verificationResponse(profile);
    }

    const timestamp = this.now().toISOString();
    const updated: VendorDdbItem = {
      ...profile,
      emailVerifiedAt: timestamp,
      emailVerificationConsumedAt: timestamp,
      emailVerificationDispatchPending: false,
      onboardingStatus: ONBOARDING_STATUS.PENDING_REVIEW,
      updatedAt: timestamp,
    };
    try {
      await this.vendorsRepository.transactVendorProfile({
        profile: updated,
        expectedUpdatedAt: profile.updatedAt,
        expectedStatus: EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS,
      });
    } catch {
      // A competing request may have consumed the same valid token. Reloading
      // makes verification deterministic without replaying the state change.
      const current = await this.vendorsRepository.getVendorById(vendorId);
      if (current?.emailVerifiedAt && current.emailVerificationConsumedAt) {
        return verificationResponse(current);
      }
      throw new ConflictError('Verification is already being processed');
    }
    return verificationResponse(updated);
  }

  async resend(request: LambdaRequest): Promise<{ vendorId: string; verificationRequestId: string; queued: true }> {
    const vendorId = getVendorId(request);
    const profile = await this.vendorsRepository.getVendorById(vendorId);
    if (!profile) throw new NotFoundError('Vendor not found');
    assertVendorAccess(request, profile);
    this.assertEligible(profile);
    if (profile.emailVerifiedAt) throw new ConflictError('Email is already verified');

    const timestamp = this.now();
    const requestedAt = profile.emailVerificationRequestedAt ? Date.parse(profile.emailVerificationRequestedAt) : 0;
    if (requestedAt && timestamp.getTime() - requestedAt < RESEND_COOLDOWN_MS && !profile.emailVerificationDispatchPending) {
      throw new RateLimitError('Please wait before requesting another verification email');
    }

    // A retry after an EventBridge error republishes the very same request.
    const isDispatchRetry = Boolean(profile.emailVerificationDispatchPending && profile.emailVerificationRequestId && profile.emailVerificationOtp);
    let current = profile;
    if (!isDispatchRetry) {
      const rawToken = generateVendorEmailVerificationOtp(vendorId);
      const at = timestamp.toISOString();
      current = {
        ...profile,
        emailVerificationRequestId: randomUUID(),
        emailVerificationOtp: rawToken,
        emailVerificationTokenHash: hashVendorEmailVerificationToken(rawToken),
        emailVerificationEmail: profile.email,
        emailVerificationExpiryMinutes: VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
        emailVerificationRequestedAt: at,
        emailVerificationExpiresAt: new Date(timestamp.getTime() + VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES * 60_000).toISOString(),
        emailVerificationRevokedAt: undefined,
        emailVerificationConsumedAt: undefined,
        emailVerificationDispatchPending: true,
        emailVerificationDispatchedAt: undefined,
        updatedAt: at,
      };
      await this.vendorsRepository.transactVendorProfile({
        profile: current,
        expectedUpdatedAt: profile.updatedAt,
        expectedStatus: EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS,
      });
    }

    // The existing DynamoDB Stream handler is the only publisher. Keeping the
    // request pending lets its retry/DLQ path preserve the same logical ID and
    // token without creating a parallel synchronous publishing path.
    return { vendorId, verificationRequestId: current.emailVerificationRequestId!, queued: true };
  }
}

let service: EmailVerificationService;
export function getEmailVerificationService() {
  if (!service) service = new EmailVerificationService();
  return service;
}
