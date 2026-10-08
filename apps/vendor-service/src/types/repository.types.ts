import {
  Address,
  BankAccountType,
  DayOfWeek,
  DocumentStatus,
  DocumentType,
  GeoLocation,
  OnboardingSection,
  OnboardingStatus,
  OperationalStatus,
  StaffStatus,
  VehicleType,
  VendorStatus,
  VendorType,
} from './api-types';

export interface VendorDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  ownerUserId: string;
  vendorType?: VendorType;
  businessName?: string;
  contactName?: string;
  phoneNumber?: string;
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
  applicationId?: string;
  communityIds?: string[];
  latestReview?: VendorStatusReviewRecord;
  primaryBranchId?: string;
  emailVerificationOtp?: string;
  emailVerificationExpiryMinutes?: number;
  emailVerificationRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
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

export interface VendorAddressDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  geoLocation?: GeoLocation;
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorAddress';
}

export interface VendorBankDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
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
  createdAt: string;
  updatedAt: string;
  entityType: 'Staff';
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
  createdAt: string;
  updatedAt: string;
  GSI3PK: string;
  GSI3SK: string;
  entityType: 'VendorCommunity';
}

export interface VendorServiceOfferingRecord {
  serviceId: string;
  categoryId?: string;
  enabled: boolean;
  priceOverride?: number;
}

export interface VendorPackageOfferingRecord {
  packageId: string;
  enabled: boolean;
  priceOverride?: number;
}

export interface VendorCapabilitiesDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  vehicleTypes: VehicleType[];
  serviceIds: string[];
  packageIds: string[];
  services?: VendorServiceOfferingRecord[];
  packages?: VendorPackageOfferingRecord[];
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorCapabilities';
}

export interface OperatingHoursEntry {
  dayOfWeek: DayOfWeek;
  closed: boolean;
  openTime?: string;
  closeTime?: string;
}

export interface VendorOperatingHoursDdbItem {
  PK: string;
  SK: string;
  vendorId: string;
  operatingHours: OperatingHoursEntry[];
  createdAt: string;
  updatedAt: string;
  entityType: 'VendorOperatingHours';
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
  | VendorCapabilitiesDdbItem
  | VendorOperatingHoursDdbItem
  | VendorStatusHistoryDdbItem
  | VendorCommunityDdbItem;
