import {
  Address,
  BankAccountType,
  CommunityCoverageApprovalStatus,
  CrewStatus,
  DocumentStatus,
  DocumentType,
  GeoLocation,
  OnboardingSection,
  OnboardingStatus,
  OperationalStatus,
  StaffStatus,
  VehicleType,
  VendorStatus,
   businessType,
} from './api-types';

export interface VendorDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  /** Legacy ownership field. New staff-created vendors use createdBy instead. */
  ownerUserId?: string;
  /** Authenticated platform staff member that created this vendor; audit only. */
  createdBy?: string;
   businessType?:  businessType;
  businessName?: string;
  contactName?: string;
  phoneNumber?: string;
  /** Explicit login contact supplied by staff; never derived from createdBy. */
  loginPhoneNumber?: string;
  identityId?: string;
  accountProvisioningStatus?: 'PENDING' | 'COMPLETED' | 'FAILED';
  accountProvisionedAt?: string;
  accountProvisioningFailure?: { code: string; message: string; at: string };
  /**
   * Deliberate provisioning retry token. Stream only re-requests provisioning
   * when this value changes (recovery tooling), never on ordinary profile edits.
   */
  accountProvisioningRetryRequestedAt?: string;
  email?: string;
  description?: string;
  profileImageUrl?: string;
  gstNumber?: string;
  panNumber?: string;
  addressCity?: string;
  addressPostalCode?: string;
  status: VendorStatus;
  operationalStatus: OperationalStatus;
  onboardingStatus: OnboardingStatus;
  currentSection: OnboardingSection;
  completedSections: OnboardingSection[];
  lastVisitedStep?: OnboardingSection;
  /** Monotonic optimistic-concurrency token. Legacy rows are treated as revision 0. */
  revision?: number;
  /** Manager confirmation of the support-prepared profile at a specific revision. */
  detailsAcceptedRevision?: number;
  detailsAcceptedAt?: string;
  applicationId?: string;
  communityIds?: string[];
  /**
   * Set only while a create transaction had to be split. Retries finish the
   * community rows from this list and then clear it. Not an API field.
   */
  pendingCommunityIds?: string[];
  /** Present only when the initial create has not finished its community rows. */
  onboardingPersistence?: 'incomplete';
  latestReview?: VendorStatusReviewRecord;
  primaryBranchId?: string;
  emailVerificationRequestId?: string;
  emailVerificationOtp?: string;
  /** Hash used by the verification endpoint; `emailVerificationOtp` is retained
   * temporarily because the existing stream/email event reads the bearer token. */
  emailVerificationTokenHash?: string;
  emailVerificationEmail?: string;
  emailVerificationExpiryMinutes?: number;
  emailVerificationRequestedAt?: string;
  emailVerificationExpiresAt?: string;
  emailVerificationConsumedAt?: string;
  emailVerificationRevokedAt?: string;
  emailVerificationDispatchPending?: boolean;
  emailVerificationDispatchedAt?: string;
  emailVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  concent?: boolean;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK?: string;
  GSI2SK?: string;
  entityType: 'Vendor';
  meta?: {
    correlationId?: string;
  };
}

export interface VendorOwnerDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  userId: string;
  fullName?: string;
  designation?: string;
  phoneNumber?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'VendorOwner';
}

/** Conditional-write lock. One item per application user. Not projected onto GSI1. */
export interface VendorOwnershipDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorOwnership';
}

export interface VendorAddressDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  /** Directory locality. Not duplicated on the vendor profile. */
  locality?: string;
  city: string;
  district?: string;
  state: string;
  country: string;
  postalCode: string;
  geoLocation?: GeoLocation;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorAddress';
  concent?: boolean;
}

export interface VendorBankDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  accountHolderName?: string;
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  branchName?: string;
  accountType?: BankAccountType;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorBank';
}

export interface VendorBranchDdbItem {
  PK: string;
  SK: string;
  branchId: string;
  vendorId: string;
  name: string;
  phoneNumber?: string;
  email?: string;
  address?: Address;
  geoLocation?: GeoLocation;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorBranch';
}

export interface VendorDocumentDdbItem {
  PK: string;
  SK: string;
  documentId: string;
  vendorId: string;
  documentType: DocumentType;
  fileName: string;
  contentType: string;
  fileSize?: number;
  bucket: string;
  objectKey: string;
  /** Previous confirmed object retained until the replacement upload is verified. */
  supersededObjectKey?: string;
  status: DocumentStatus;
  reviewComment?: string;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorDocument';
}

export interface ServiceAreaDdbItem {
  PK: string;
  SK: string;
  serviceAreaId: string;
  vendorId: string;
  name: string;
  city: string;
  state?: string;
  postalCodes?: string[];
  center?: GeoLocation;
  radiusKm?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  entityType: 'ServiceArea';
}

export interface StaffDdbItem {
  PK: string;
  SK: string;
  staffId: string;
  vendorId: string;
  userId?: string;
  name: string;
  phoneNumber: string;
  email?: string;
  role?: string;
  status: StaffStatus;
  provisioningStatus?: 'PENDING' | 'COMPLETED' | 'FAILED';
  identityId?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  entityType: 'Staff';
}

export interface StaffPhoneDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  staffId: string;
  phoneNumber: string;
  entityType: 'StaffPhone';
}

export interface CrewDdbItem {
  PK: string;
  SK: string;
  crewId: string;
  vendorId: string;
  name: string;
  vanLabel: string;
  staffIds: string[];
  /** Designated crew contact; must be one of `staffIds`. Absent on crews created before designation existed. */
  pointOfContactStaffId?: string;
  status: CrewStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  entityType: 'Crew';
}

export interface VendorStatusReviewRecord {
  previousStatus: VendorStatus;
  newStatus: VendorStatus;
  reviewerUserId: string;
  reason?: string;
  reviewedAt: string;
  correlationId?: string;
}

export interface VendorStatusHistoryDdbItem extends VendorStatusReviewRecord {
  PK: string;
  SK: string;
  vendorId: string;
  entityType: 'VendorStatusHistory';
}

export interface VendorCommunityDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  communityId: string;
  assignedBy: string;
  assignedAt: string;
  status: VendorStatus;
  operationalStatus: OperationalStatus;
  /** Ops-owned. Absent on legacy rows, which read as PENDING (never auto-approved). */
  approvalStatus?: CommunityCoverageApprovalStatus;
  approvalRequestedAt?: string;
  approvalUpdatedAt?: string;
  approvalUpdatedBy?: string;
  approvalReason?: string;
  createdAt: string;
  updatedAt: string;
  GSI3PK: string;
  GSI3SK: string;
  entityType: 'VendorCommunity';
}

export interface VendorCoverageHistoryDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  communityId: string;
  historyId: string;
  fromStatus: CommunityCoverageApprovalStatus;
  toStatus: CommunityCoverageApprovalStatus;
  actorUserId: string;
  reason?: string;
  at: string;
  entityType: 'VendorCoverageHistory';
}

export interface VendorServiceOfferingRecord {
  serviceId: string;
  categoryId?: string;
  enabled: boolean;
  priceOverride?: number;
  /** Server-owned. Increments when enabled or priceOverride changes. */
  version?: number;
}

export interface VendorPackageOfferingRecord {
  packageId: string;
  enabled: boolean;
  priceOverride?: number;
  /** Server-owned. Increments when enabled or priceOverride changes. */
  version?: number;
}

export interface VendorCapabilitiesDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  vehicleTypes: VehicleType[];
  /** Capability ids from the canonical catalog, e.g. wash:FOAM. Absent on legacy items. */
  washMethods?: string[];
  /** Capability ids from the canonical catalog, e.g. service:CAR_WASH. Absent on legacy items. */
  serviceTypes?: string[];
  serviceIds: string[];
  packageIds: string[];
  services?: VendorServiceOfferingRecord[];
  packages?: VendorPackageOfferingRecord[];
  /** Server-owned. Increments when any pricing input on this item changes. */
  configurationVersion?: number;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorCapabilities';
}

/** Selected service-window ids. This is the operating section vendor detail and onboarding read. */
export interface VendorOperatingPreferencesDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  serviceWindowIds: string[];
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorOperatingPreferences';
}

/**
 * Partner-declared planning figures. This is not a capacity commitment and
 * does not reserve sold capacity.
 */
export interface VendorIndicativeCapacityDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  activeCrewCount: number;
  indicativeVisitsPerWeek: number;
  capacityKind: 'indicative';
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorIndicativeCapacity';
}

/** Non-binding onboarding planning estimates. Does not affect sold capacity. */
export interface VendorBaselineCapacityDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  communityId: string;
  estimatedCrews?: number;
  estimatedVisitsPerDay?: number;
  serviceWindowNotes?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorBaselineCapacity';
}

export type VendorChildDdbItem =
  | VendorDdbItem
  | VendorOwnerDdbItem
  | VendorAddressDdbItem
  | VendorBankDdbItem
  | VendorBranchDdbItem
  | VendorDocumentDdbItem
  | ServiceAreaDdbItem
  | StaffDdbItem
  | StaffPhoneDdbItem
  | CrewDdbItem
  | VendorCapabilitiesDdbItem
  | VendorOperatingPreferencesDdbItem
  | VendorIndicativeCapacityDdbItem
  | VendorStatusHistoryDdbItem
  | VendorCommunityDdbItem
  | VendorCoverageHistoryDdbItem
  | VendorBaselineCapacityDdbItem;
