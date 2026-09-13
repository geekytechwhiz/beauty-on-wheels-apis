export const ONBOARDING_SECTION = {
  BUSINESS_INFO: 'BUSINESS_INFO',
  OWNER_DETAILS: 'OWNER_DETAILS',
  ADDRESS: 'ADDRESS',
  BRANCH: 'BRANCH',
  DOCUMENTS: 'DOCUMENTS',
  BANK_DETAILS: 'BANK_DETAILS',
} as const;

export type OnboardingSection =
  (typeof ONBOARDING_SECTION)[keyof typeof ONBOARDING_SECTION];

export const ONBOARDING_SECTION_ORDER: OnboardingSection[] = [
  ONBOARDING_SECTION.BUSINESS_INFO,
  ONBOARDING_SECTION.OWNER_DETAILS,
  ONBOARDING_SECTION.ADDRESS,
  ONBOARDING_SECTION.BRANCH,
  ONBOARDING_SECTION.DOCUMENTS,
  ONBOARDING_SECTION.BANK_DETAILS,
];

export const ONBOARDING_STATUS = {
  DRAFT: 'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  /** Historical value; new completions persist as PENDING_REVIEW. */
  COMPLETED: 'COMPLETED',
  PENDING_REVIEW: 'PENDING_REVIEW',
} as const;

export type OnboardingStatus =
  (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];

export const DOCUMENT_TYPE = {
  GST_REGISTRATION: 'GST_REGISTRATION',
  BUSINESS_REGISTRATION: 'BUSINESS_REGISTRATION',
  COMMERCIAL_INSURANCE: 'COMMERCIAL_INSURANCE',
} as const;

export type DocumentType = (typeof DOCUMENT_TYPE)[keyof typeof DOCUMENT_TYPE];

export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = [
  DOCUMENT_TYPE.GST_REGISTRATION,
  DOCUMENT_TYPE.BUSINESS_REGISTRATION,
  DOCUMENT_TYPE.COMMERCIAL_INSURANCE,
];

export const DOCUMENT_STATUS = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  UPLOADED: 'UPLOADED',
} as const;

export type DocumentStatus =
  (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

export const BANK_ACCOUNT_TYPE = {
  SAVINGS: 'SAVINGS',
  CURRENT: 'CURRENT',
} as const;

export type BankAccountType =
  (typeof BANK_ACCOUNT_TYPE)[keyof typeof BANK_ACCOUNT_TYPE];

const ONBOARDING_SECTION_VALUES = new Set<string>(ONBOARDING_SECTION_ORDER);

export function isOnboardingSection(value: unknown): value is OnboardingSection {
  return typeof value === 'string' && ONBOARDING_SECTION_VALUES.has(value);
}

export interface OnboardingCompletenessInput {
  hasBusinessInfo: boolean;
  hasOwner: boolean;
  hasAddress: boolean;
  hasBranch: boolean;
  documentTypes: Iterable<string>;
  hasBankDetails: boolean;
}

export interface ComputedOnboardingState {
  status: OnboardingStatus;
  currentSection: OnboardingSection;
  completedSections: OnboardingSection[];
}

export function isBusinessInfoComplete(input: {
  vendorType?: string;
  businessName?: string;
  contactName?: string;
  phoneNumber?: string;
}): boolean {
  return Boolean(
    input.vendorType?.trim() &&
      input.businessName?.trim() &&
      input.contactName?.trim() &&
      input.phoneNumber?.trim(),
  );
}

export function isOwnerComplete(input: {
  userId?: string;
  fullName?: string;
}): boolean {
  return Boolean(input.userId?.trim() && input.fullName?.trim());
}

export function isAddressComplete(input: {
  addressLine1?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}): boolean {
  return Boolean(
    input.addressLine1?.trim() &&
      input.city?.trim() &&
      input.state?.trim() &&
      input.country?.trim() &&
      input.postalCode?.trim(),
  );
}

export function isBankComplete(input: {
  accountHolderName?: string;
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
}): boolean {
  return Boolean(
    input.accountHolderName?.trim() &&
      input.accountNumber?.trim() &&
      input.ifscCode?.trim() &&
      input.bankName?.trim(),
  );
}

export function areRequiredDocumentsComplete(
  documentTypes: Iterable<string>,
): boolean {
  const present = new Set(documentTypes);
  return REQUIRED_DOCUMENT_TYPES.every((type) => present.has(type));
}

export function computeOnboardingState(
  input: OnboardingCompletenessInput,
): ComputedOnboardingState {
  const completedSections: OnboardingSection[] = [];

  if (input.hasBusinessInfo) {
    completedSections.push(ONBOARDING_SECTION.BUSINESS_INFO);
  }
  if (input.hasOwner) {
    completedSections.push(ONBOARDING_SECTION.OWNER_DETAILS);
  }
  if (input.hasAddress) {
    completedSections.push(ONBOARDING_SECTION.ADDRESS);
  }
  if (input.hasBranch) {
    completedSections.push(ONBOARDING_SECTION.BRANCH);
  }
  if (areRequiredDocumentsComplete(input.documentTypes)) {
    completedSections.push(ONBOARDING_SECTION.DOCUMENTS);
  }
  if (input.hasBankDetails) {
    completedSections.push(ONBOARDING_SECTION.BANK_DETAILS);
  }

  const currentSection =
    ONBOARDING_SECTION_ORDER.find(
      (section) => !completedSections.includes(section),
    ) ?? ONBOARDING_SECTION.BANK_DETAILS;

  let status: OnboardingStatus = ONBOARDING_STATUS.DRAFT;
  if (completedSections.length === ONBOARDING_SECTION_ORDER.length) {
    status = ONBOARDING_STATUS.PENDING_REVIEW;
  } else if (completedSections.length > 0) {
    status = ONBOARDING_STATUS.IN_PROGRESS;
  }

  return { status, currentSection, completedSections };
}
