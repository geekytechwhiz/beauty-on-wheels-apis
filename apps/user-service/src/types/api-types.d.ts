/**
 * Runtime JSON contracts for the user service.
 * Enum values are camelCase.
 */

export type UserStatus = 'active' | 'inactive' | 'suspended';
export type AddressType = 'home' | 'work' | 'business';
export type CommunityStatus = 'active' | 'inactive';

export interface PhoneLookupResult {
  id: string;
  phone: string;
  status: UserStatus;
}

export interface User {
  id: string;
  status: UserStatus;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  profileImage?: string;
}

export interface CustomerProfileUpdate {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  profileImage?: string;
  status?: UserStatus;
  preferredLanguage?: string;
  loyaltyPoints?: number;
}

export interface CustomerProfile {
  userId: string;
  status: UserStatus;
  communityIds: string[];
  createdAt: string;
  updatedAt: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  profileImage?: string;
  preferredLanguage?: string;
  loyaltyPoints?: number;
  defaultAddressId?: string;
}

export interface AddressRequest {
  type?: AddressType;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

export interface Address {
  id: string;
  userId: string;
  type: AddressType;
  line1: string;
  city: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  line2?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

export interface AddressListResponse {
  items: Address[];
}

export interface OperationalPreferencesUpdate {
  whatsapp: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  language?: string;
  timezone?: string;
}

export interface OperationalPreferences {
  userId: string;
  whatsapp: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  language?: string;
  timezone?: string;
  updatedAt?: string;
}

export interface CommunityCreate {
  name: string;
  code?: string;
  city?: string;
}

export interface CommunityUpdate {
  name?: string;
  code?: string;
  city?: string;
  status?: CommunityStatus;
}

export interface Community {
  communityId: string;
  name: string;
  status: CommunityStatus;
  createdAt: string;
  updatedAt: string;
  code?: string;
  city?: string;
}

export interface CommunityListResponse {
  items: Community[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface CustomerCommunitiesUpdate {
  communityIds: string[];
}

export interface CustomerCommunities {
  userId: string;
  communityIds: string[];
}
