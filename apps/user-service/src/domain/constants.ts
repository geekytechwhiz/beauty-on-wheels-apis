export const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const ADDRESS_TYPE = {
  HOME: 'home',
  WORK: 'work',
  BUSINESS: 'business',
} as const;

export type AddressType = (typeof ADDRESS_TYPE)[keyof typeof ADDRESS_TYPE];

export const ADDRESS_STATUS = {
  ACTIVE: 'active',
  DELETED: 'deleted',
} as const;

export type AddressStatus = (typeof ADDRESS_STATUS)[keyof typeof ADDRESS_STATUS];

export const COMMUNITY_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;

export type CommunityStatus =
  (typeof COMMUNITY_STATUS)[keyof typeof COMMUNITY_STATUS];

export const ENTITY_TYPE = {
  CUSTOMER_PROFILE: 'CustomerProfile',
  PHONE_LOOKUP: 'PhoneLookup',
  ADDRESS: 'Address',
  OPERATIONAL_PREFERENCES: 'OperationalPreferences',
  COMMUNITY: 'Community',
  COMMUNITY_MEMBERSHIP: 'CommunityMembership',
} as const;

export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

export const DEFAULT_OPERATIONAL_PREFERENCES = {
  whatsapp: true,
  sms: true,
  email: true,
  push: true,
} as const;

export const MAX_COMMUNITY_MEMBERSHIPS = 20;
