/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export type VendorStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'REJECTED';

export type OperationalStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'TEMPORARILY_UNAVAILABLE';

export type VendorType = 'INDIVIDUAL' | 'BUSINESS';

export type VehicleType = 'HATCHBACK' | 'SEDAN' | 'SUV' | 'MUV' | 'LUXURY' | 'BIKE';

export type StaffStatus = 'ACTIVE' | 'INACTIVE';

export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export type OnboardingSection =
  | 'BUSINESS_INFO'
  | 'OWNER_DETAILS'
  | 'ADDRESS'
  | 'BRANCH'
  | 'DOCUMENTS'
  | 'BANK_DETAILS';

export type OnboardingStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'PENDING_REVIEW';

export type DocumentType =
  | 'GST_REGISTRATION'
  | 'BUSINESS_REGISTRATION'
  | 'COMMERCIAL_INSURANCE';

export type DocumentStatus = 'PENDING_UPLOAD' | 'UPLOADED';

export type BankAccountType = 'SAVINGS' | 'CURRENT';

export type CapabilityCategory = 'vehicleType';

export interface Address {
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
}

export interface CreateVendorRequest {
  businessName: string;
  contactName: string;
  phoneNumber?: string;
  email?: string;
  description?: string;
  gstNumber?: string;
  panNumber?: string;
  profileImageUrl?: string;
  vendorType?: VendorType;
}

export interface UpdateVendorRequest {
  businessName?: string;
  contactName?: string;
  phoneNumber?: string;
  email?: string;
  description?: string;
  profileImageUrl?: string;
}

export interface UpdateVendorStatusRequest {
  status: VendorStatus;
  reason?: string;
}

export interface ApproveVendorRequest {
  reason?: string;
}

export interface RejectVendorRequest {
  reason: string;
}

export interface VendorStatusReview {
  previousStatus: VendorStatus;
  newStatus: VendorStatus;
  reviewerUserId: string;
  reason?: string;
  reviewedAt: string;
  correlationId?: string;
}

export interface VendorStatusHistoryEntry extends VendorStatusReview {
  vendorId: string;
}

export interface UpdateOperationalStatusRequest {
  operationalStatus: OperationalStatus;
}

export interface BusinessInfoData {
  vendorType: VendorType;
  businessName: string;
  contactName: string;
  phoneNumber: string;
  email?: string;
  description?: string;
  gstNumber?: string;
  panNumber?: string;
  profileImageUrl?: string;
}

export interface OwnerDetailsData {
  userId?: string;
  fullName: string;
  designation?: string;
  phoneNumber?: string;
  email?: string;
}

export interface AddressData {
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  geoLocation?: GeoLocation;
}

export interface BranchData {
  branchId?: string;
  name: string;
  phoneNumber?: string;
  email?: string;
  address?: Address;
  geoLocation?: GeoLocation;
  isPrimary?: boolean;
}

export interface DocumentsData {
  documentType: DocumentType;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface BankDetailsData {
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName?: string;
  accountType?: BankAccountType;
}

export interface UpdateOnboardingRequest {
  section: OnboardingSection;
  data:
    | BusinessInfoData
    | OwnerDetailsData
    | AddressData
    | BranchData
    | DocumentsData
    | BankDetailsData;
}

export interface VendorOwner {
  vendorId: string;
  userId: string;
  fullName?: string;
  designation?: string;
  phoneNumber?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorAddress {
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
}

export interface BankDetails {
  vendorId: string;
  accountHolderName: string;
  accountNumberLast4: string;
  accountNumberMasked: string;
  ifscCode: string;
  bankName: string;
  branchName?: string;
  accountType?: BankAccountType;
  createdAt: string;
  updatedAt: string;
}

export interface VendorBranch {
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
}

export interface CreateBranchRequest {
  name: string;
  phoneNumber?: string;
  email?: string;
  address?: Address;
  geoLocation?: GeoLocation;
  isPrimary?: boolean;
}

export interface UpdateBranchRequest {
  name?: string;
  phoneNumber?: string;
  email?: string;
  address?: Address;
  geoLocation?: GeoLocation;
  isPrimary?: boolean;
}

export interface VendorDocument {
  documentId: string;
  vendorId: string;
  documentType: DocumentType;
  fileName: string;
  contentType: string;
  fileSize?: number;
  objectKey: string;
  status: DocumentStatus;
  uploadUrl?: string;
  downloadUrl?: string;
  expiresIn?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentRequest {
  documentType: DocumentType;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface UpdateDocumentRequest {
  fileName?: string;
  contentType?: string;
  fileSize?: number;
}

export interface OnboardingState {
  vendorId: string;
  status: OnboardingStatus;
  currentSection: OnboardingSection;
  completedSections: OnboardingSection[];
}

export interface OnboardingResponse {
  vendorId: string;
  status: OnboardingStatus;
  currentSection: OnboardingSection;
  completedSections: OnboardingSection[];
  applicationId?: string;
  sections: {
    BUSINESS_INFO?: BusinessInfoData;
    OWNER_DETAILS?: VendorOwner;
    ADDRESS?: VendorAddress;
    BRANCH?: VendorBranch[];
    DOCUMENTS?: VendorDocument[];
    BANK_DETAILS?: BankDetails;
  };
}

export interface Vendor {
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
  address?: Address;
  geoLocation?: GeoLocation;
  status: VendorStatus;
  operationalStatus: OperationalStatus;
  onboardingStatus: OnboardingStatus;
  currentSection?: OnboardingSection;
  completedSections?: OnboardingSection[];
  applicationId?: string;
  communityIds: string[];
  latestReview?: VendorStatusReview;
  createdAt: string;
  updatedAt: string;
}

export type VendorNextAction =
  | 'START_ONBOARDING'
  | 'RESUME_ONBOARDING'
  | 'VIEW_APPLICATION_STATUS'
  | 'OPEN_VENDOR_DASHBOARD'
  | 'COMPLETE_VENDOR_SETUP'
  | 'VIEW_ACCOUNT_STATUS'
  | 'CORRECT_APPLICATION';

export interface VendorSelfLookup {
  hasVendor: boolean;
  vendorId?: string;
  status?: VendorStatus | OnboardingStatus;
  onboarding?: {
    currentStep: OnboardingSection;
    completed: boolean;
  };
  nextAction: VendorNextAction;
}

export interface VendorResponse {
  data: Vendor;
}

export interface VendorListResponse {
  data: Vendor[];
  pagination?: Pagination;
}

export interface CreateServiceAreaRequest {
  name: string;
  city: string;
  state?: string;
  postalCodes?: string[];
  center?: GeoLocation;
  radiusKm?: number;
  active?: boolean;
}

export interface UpdateServiceAreaRequest {
  name?: string;
  city?: string;
  state?: string;
  postalCodes?: string[];
  center?: GeoLocation;
  radiusKm?: number;
  active?: boolean;
}

export type ServiceArea = CreateServiceAreaRequest & ({
  serviceAreaId: string;
  vendorId: string;
  createdAt: string;
  updatedAt: string;
});

export interface OperatingHoursRequest {
  dayOfWeek: DayOfWeek;
  closed: boolean;
  openTime?: string;
  closeTime?: string;
}

export type OperatingHours = OperatingHoursRequest & ({
  vendorId?: string;
});

export interface UpdateVendorOperatingHoursRequest {
  operatingHours: OperatingHoursRequest[];
}

export interface CreateStaffRequest {
  userId?: string;
  name: string;
  phoneNumber: string;
  email?: string;
  role?: string;
  status?: StaffStatus;
}

export interface UpdateStaffRequest {
  name?: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  status?: StaffStatus;
}

export interface Staff {
  staffId: string;
  vendorId: string;
  userId?: string;
  name: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  status: StaffStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StaffResponse {
  data?: Staff;
}

export interface StaffListResponse {
  data?: Staff[];
  pagination?: Pagination;
}

export interface CapabilityDefinition {
  capabilityId: string;
  category: CapabilityCategory;
  code: VehicleType;
  name: string;
}

export interface AvailableCapabilities {
  vehicleTypes: CapabilityDefinition[];
  catalogSources: {
    services: string;
    packages: string;
  };
}

export interface VendorServiceOffering {
  serviceId: string;
  categoryId?: string;
  enabled: boolean;
  priceOverride?: number;
}

export interface VendorPackageOffering {
  packageId: string;
  enabled: boolean;
  priceOverride?: number;
}

export interface VendorCapabilities {
  vendorId: string;
  vehicleTypes: VehicleType[];
  serviceIds: string[];
  packageIds: string[];
  services: VendorServiceOffering[];
  packages: VendorPackageOffering[];
  updatedAt?: string;
}

export interface UpdateVendorCapabilitiesRequest {
  vehicleTypes: VehicleType[];
  serviceIds?: string[];
  packageIds?: string[];
  services?: VendorServiceOffering[];
  packages?: VendorPackageOffering[];
}

export interface ReplaceVendorServicesRequest {
  services: VendorServiceOffering[];
}

export interface ReplaceVendorPackagesRequest {
  packages: VendorPackageOffering[];
}

export interface VendorCommunityAssignment {
  vendorId: string;
  communityId: string;
  assignedBy: string;
  assignedAt: string;
  status: VendorStatus;
  operationalStatus: OperationalStatus;
}

export interface ReplaceVendorCommunitiesRequest {
  communityIds: string[];
}

export interface AddVendorCommunityRequest {
  communityId: string;
}

export interface Pagination {
  nextCursor?: (string) | null;
  hasMore?: boolean;
}

export interface Error {
  code: string;
  message: string;
  correlationId?: string;
  details?: ({
    [key: string]: any;
  })[];
}
