export const TABLE_NAME = 'identity-table-dev';

export const GSI_INDEX_NAMES = {
  GSI1: process.env['GSI1_INDEX_NAME'] || 'GSI1',
  GSI2: process.env['GSI2_INDEX_NAME'] || 'GSI1', // default to GSI1 if other GSIs are not available
  GSI3: process.env['GSI3_INDEX_NAME'] || 'GSI1',
  GSI4: process.env['GSI4_INDEX_NAME'] || 'GSI1',
  GSI5: process.env['GSI5_INDEX_NAME'] || 'GSI1',
};

// Casing values for standard attributes
export const DDB_KEYS = {
  PK: 'PK',
  SK: 'SK',
  GSI1PK: 'GSI1PK',
  GSI1SK: 'GSI1SK',
  GSI2PK: 'GSI2PK',
  GSI2SK: 'GSI2SK',
  GSI5PK: 'GSI5PK',
  GSI5SK: 'GSI5SK',
};

export const PREFIXES = {
  USER: 'USER#',
  EMAIL: 'EMAIL#',
  PHONE: 'PHONE#',
  USERNAME: 'USERNAME#',
  SESSION: 'SESSION#',
  REFRESH: 'REFRESH#',
  OTP: 'OTP#',
  ROLE: 'ROLE#',
  PERMISSION: 'PERMISSION#',
  LOGIN_HISTORY: 'LOGIN_HISTORY#',
  PASSWORD_HISTORY: 'PASSWORD_HISTORY#',
  AUDIT: 'AUDIT#',
};

export const SK_VALS = {
  LOOKUP: 'LOOKUP',
  PROFILE: 'PROFILE',
  META: 'META',
  METADATA: 'METADATA',
};

export const ENTITY_TYPES = {
  USER: 'User',
  PROFILE: 'Profile',
  EMAIL_LOOKUP: 'EmailLookup',
  PHONE_LOOKUP: 'PhoneLookup',
  USERNAME_LOOKUP: 'UsernameLookup',
  SESSION: 'Session',
  REFRESH_TOKEN_LOOKUP: 'RefreshTokenLookup',
  OTP: 'Otp',
  USER_ROLE: 'UserRole',
  ROLE: 'Role',
  PERMISSION: 'Permission',
  LOGIN_HISTORY: 'LoginHistory',
  PASSWORD_HISTORY: 'PasswordHistory',
  AUDIT: 'AuditLog',
};

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

export type SessionStatus =
  (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];
