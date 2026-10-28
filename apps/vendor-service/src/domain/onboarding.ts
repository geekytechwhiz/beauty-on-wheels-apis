export const ONBOARDING_SECTION = {
  BUSINESS_INFO: 'BUSINESS_INFO',
  COMMUNITIES: 'COMMUNITIES',
  DOCUMENTS: 'DOCUMENTS',
  BANK_DETAILS: 'BANK_DETAILS',
} as const;

export type OnboardingSection =
  (typeof ONBOARDING_SECTION)[keyof typeof ONBOARDING_SECTION];

export const ONBOARDING_SECTION_ORDER: OnboardingSection[] = [
  ONBOARDING_SECTION.BUSINESS_INFO,
  ONBOARDING_SECTION.COMMUNITIES,
  ONBOARDING_SECTION.DOCUMENTS,
  ONBOARDING_SECTION.BANK_DETAILS,
];

export const ONBOARDING_STATUS = {
  DRAFT: 'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  AWAITING_EMAIL_VERIFICATION: 'AWAITING_EMAIL_VERIFICATION',
  PENDING_REVIEW: 'PENDING_REVIEW',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  /** Retained only so existing persisted applications remain readable. */
  COMPLETED: 'COMPLETED',
} as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];

export const DOCUMENT_TYPE = {
  BUSINESS_REGISTRATION: 'BUSINESS_REGISTRATION',
  OWNER_IDENTITY: 'OWNER_IDENTITY',
  GST_REGISTRATION: 'GST_REGISTRATION',
  COMMERCIAL_INSURANCE: 'COMMERCIAL_INSURANCE',
} as const;
export type DocumentType = (typeof DOCUMENT_TYPE)[keyof typeof DOCUMENT_TYPE];

/** MVP policy: proof of registration and owner identity. */
export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = [
  DOCUMENT_TYPE.BUSINESS_REGISTRATION,
  DOCUMENT_TYPE.OWNER_IDENTITY,
];

export const DOCUMENT_STATUS = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  UPLOADED: 'UPLOADED',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

export const BANK_ACCOUNT_TYPE = { SAVINGS: 'SAVINGS', CURRENT: 'CURRENT' } as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPE)[keyof typeof BANK_ACCOUNT_TYPE];

const ONBOARDING_SECTION_VALUES = new Set<string>(ONBOARDING_SECTION_ORDER);
export function isOnboardingSection(value: unknown): value is OnboardingSection {
  return typeof value === 'string' && ONBOARDING_SECTION_VALUES.has(value);
}

export interface OnboardingCompletenessInput {
  hasBusinessInfo: boolean;
  hasCommunities: boolean;
  documentTypes: Iterable<string>;
  hasBankDetails: boolean;
}
export interface ComputedOnboardingState {
  status: OnboardingStatus;
  currentSection: OnboardingSection;
  completedSections: OnboardingSection[];
}

export function isBusinessInfoComplete(input: { businessType?: string; businessName?: string; contactName?: string; phoneNumber?: string }): boolean {
  return Boolean(input.businessType?.trim() && input.businessName?.trim() && input.contactName?.trim() && input.phoneNumber?.trim());
}
export function isBankComplete(input: { accountHolderName?: string; accountNumber?: string; ifscCode?: string; bankName?: string }): boolean {
  return Boolean(input.accountHolderName?.trim() && input.accountNumber?.trim() && input.ifscCode?.trim() && input.bankName?.trim());
}
export function areRequiredDocumentsComplete(documentTypes: Iterable<string>): boolean {
  const present = new Set(documentTypes);
  return REQUIRED_DOCUMENT_TYPES.every((type) => present.has(type));
}
export function computeOnboardingState(input: OnboardingCompletenessInput): ComputedOnboardingState {
  const completedSections: OnboardingSection[] = [];
  if (input.hasBusinessInfo) completedSections.push(ONBOARDING_SECTION.BUSINESS_INFO);
  if (input.hasCommunities) completedSections.push(ONBOARDING_SECTION.COMMUNITIES);
  if (areRequiredDocumentsComplete(input.documentTypes)) completedSections.push(ONBOARDING_SECTION.DOCUMENTS);
  if (input.hasBankDetails) completedSections.push(ONBOARDING_SECTION.BANK_DETAILS);
  const currentSection = ONBOARDING_SECTION_ORDER.find((section) => !completedSections.includes(section)) ?? ONBOARDING_SECTION.BANK_DETAILS;
  return { status: completedSections.length === 0 ? ONBOARDING_STATUS.DRAFT : ONBOARDING_STATUS.IN_PROGRESS, currentSection, completedSections };
}
