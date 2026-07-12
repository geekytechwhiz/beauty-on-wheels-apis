/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface User {
  id?: string;
  identityId?: string;
  userType?: 'CUSTOMER' | 'VENDOR' | 'ADMIN';
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  profileImage?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface Address {
  id?: string;
  type?: 'HOME' | 'WORK' | 'BUSINESS';
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

export interface CustomerProfile {
  loyaltyPoints?: number;
  preferredLanguage?: string;
  marketingConsent?: boolean;
}

export interface VendorProfile {
  businessName?: string;
  businessType?: string;
  gstNumber?: string;
  licenseNumber?: string;
  onboardingStatus?: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
}

export interface Preference {
  notifications?: boolean;
  emailNotifications?: boolean;
  smsNotifications?: boolean;
  language?: string;
  timezone?: string;
}

