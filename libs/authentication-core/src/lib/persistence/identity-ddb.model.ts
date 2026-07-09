import type {
  SessionStatus,
  UserStatus,
} from '../constants/identity.constants';

export interface BaseDdbRecord {
  pk: string;
  sk: string;
  entityType: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserMetaDdbRecord extends BaseDdbRecord {
  entityType: 'User';
  userId: string;
  email: string;
  username: string;
  phoneNumber: string;
  passwordHash: string;
  roleId: string;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  version: number;
  gsi4pk: string;
  gsi4sk: string;
}

export interface UserProfileDdbRecord extends BaseDdbRecord {
  entityType: 'Profile';
  userId: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  language?: string;
  timezone?: string;
}

export interface EmailLookupDdbRecord extends BaseDdbRecord {
  entityType: 'EmailLookup';
  email: string;
  userId: string;
}

export interface PhoneLookupDdbRecord extends BaseDdbRecord {
  entityType: 'PhoneLookup';
  phoneNumber: string;
  userId: string;
}

export interface UsernameLookupDdbRecord extends BaseDdbRecord {
  entityType: 'UsernameLookup';
  username: string;
  userId: string;
}

export interface SessionDdbRecord extends BaseDdbRecord {
  entityType: 'Session';
  sessionId: string;
  userId: string;
  refreshTokenHash: string;
  device?: string;
  ipAddress?: string;
  status: SessionStatus;
  expiresAt: string;
  ttl?: number;
  gsi2pk: string;
  gsi2sk: string;
}

export interface OtpDdbRecord extends BaseDdbRecord {
  entityType: 'Otp';
  otpId: string;
  userId: string;
  purpose: string;
  referenceId: string;
  codeHash: string;
  attempts: number;
  verified: boolean;
  expiresAt: string;
  ttl?: number;
  gsi3pk: string;
  gsi3sk: string;
}

export interface RefreshTokenLookupDdbRecord extends BaseDdbRecord {
  entityType: 'RefreshTokenLookup';
  tokenHash: string;
  userId: string;
  sessionId: string;
  expiresAt: string;
  ttl?: number;
  gsi2pk: string;
  gsi2sk: string;
}

export type IdentityDdbRecord =
  | UserMetaDdbRecord
  | UserProfileDdbRecord
  | EmailLookupDdbRecord
  | PhoneLookupDdbRecord
  | UsernameLookupDdbRecord
  | SessionDdbRecord
  | OtpDdbRecord
  | RefreshTokenLookupDdbRecord;
