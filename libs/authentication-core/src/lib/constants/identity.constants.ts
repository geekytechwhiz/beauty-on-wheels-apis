export const ENTITY_TYPE_USER = 'User' as const;
export const ENTITY_TYPE_PROFILE = 'Profile' as const;
export const ENTITY_TYPE_EMAIL_LOOKUP = 'EmailLookup' as const;
export const ENTITY_TYPE_PHONE_LOOKUP = 'PhoneLookup' as const;
export const ENTITY_TYPE_USERNAME_LOOKUP = 'UsernameLookup' as const;
export const ENTITY_TYPE_SESSION = 'Session' as const;
export const ENTITY_TYPE_OTP = 'Otp' as const;
export const ENTITY_TYPE_REFRESH_TOKEN_LOOKUP = 'RefreshTokenLookup' as const;

export const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const SESSION_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export const USER_META_SK = 'META' as const;
export const USER_PROFILE_SK = 'PROFILE' as const;
export const LOOKUP_SK = 'LOOKUP' as const;

export const SESSION_SK_PREFIX = 'SESSION#' as const;
export const OTP_SK_PREFIX = 'OTP#' as const;

export const GSI1_ROLE_CATALOG = 'GSI1' as const;
export const GSI2_REFRESH_TOKEN = 'GSI2' as const;
export const GSI3_OTP_REFERENCE = 'GSI3' as const;
export const GSI4_USER_STATUS = 'GSI4' as const;

export const ROLE_CATALOG_PK = 'ROLE_CATALOG' as const;
export const STATUS_GSI_PREFIX = 'STATUS#' as const;
export const REFRESH_GSI_PREFIX = 'REFRESH#' as const;
export const OTP_REF_GSI_PREFIX = 'OTP_REF#' as const;

export const INITIAL_USER_VERSION = 1;
