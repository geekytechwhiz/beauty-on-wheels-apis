/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export type VendorStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'REJECTED';

export type OperationalStatus = 'ONLINE' | 'OFFLINE' | 'BUSY' | 'TEMPORARILY_UNAVAILABLE';

export type VendorType = 'INDIVIDUAL' | 'BUSINESS';

export type VehicleType = 'HATCHBACK' | 'SEDAN' | 'SUV' | 'MUV' | 'LUXURY' | 'OTHER';

export type StaffStatus = 'ACTIVE' | 'INACTIVE';

export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

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
  ownerUserId: string;
  vendorType: VendorType;
  businessName: string;
  contactName: string;
  phoneNumber: string;
  email?: string;
  description?: string;
  address: Address;
  geoLocation?: GeoLocation;
}

export interface UpdateVendorRequest {
  businessName?: string;
  contactName?: string;
  phoneNumber?: string;
  email?: string;
  description?: string;
  address?: Address;
  geoLocation?: GeoLocation;
  profileImageUrl?: string;
}

export interface UpdateVendorStatusRequest {
  status: VendorStatus;
  reason?: string;
}

export interface UpdateOperationalStatusRequest {
  operationalStatus: OperationalStatus;
}

export interface Vendor {
  vendorId: string;
  ownerUserId: string;
  vendorType: VendorType;
  businessName: string;
  contactName?: string;
  phoneNumber?: string;
  email?: string;
  description?: string;
  profileImageUrl?: string;
  address?: Address;
  geoLocation?: GeoLocation;
  status: VendorStatus;
  operationalStatus: OperationalStatus;
  createdAt: string;
  updatedAt: string;
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

export interface VendorCapabilities {
  vendorId: string;
  vehicleTypes: VehicleType[];
  serviceIds: string[];
  packageIds: string[];
  updatedAt?: string;
}

export interface UpdateVendorCapabilitiesRequest {
  vehicleTypes: VehicleType[];
  serviceIds: string[];
  packageIds: string[];
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

