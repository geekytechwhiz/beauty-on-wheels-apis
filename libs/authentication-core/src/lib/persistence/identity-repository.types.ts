import type { UserStatus } from '../constants/identity.constants';
import type {
  SessionDdbRecord,
  UserMetaDdbRecord,
  UserProfileDdbRecord,
  OtpDdbRecord,
} from './identity-ddb.model';

export interface CreateUserRepoInput {
  userId: string;
  email: string;
  username: string;
  phoneNumber: string;
  passwordHash: string;
  roleId: string;
  status: UserStatus;
  profile?: SaveProfileRepoInput;
}

export interface UpdateUserRepoInput {
  userId: string;
  expectedVersion: number;
  email?: string;
  username?: string;
  phoneNumber?: string;
  roleId?: string;
}

export interface SaveProfileRepoInput {
  userId: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  language?: string;
  timezone?: string;
}

export interface UpdateProfileRepoInput {
  userId: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  language?: string;
  timezone?: string;
}

export interface CreateSessionRepoInput {
  userId: string;
  sessionId: string;
  refreshTokenHash: string;
  device?: string;
  ipAddress?: string;
  expiresAt: string;
  ttl?: number;
}

export interface SaveOtpRepoInput {
  userId: string;
  otpId: string;
  purpose: string;
  referenceId: string;
  codeHash: string;
  expiresAt: string;
  ttl?: number;
}

export interface SaveRefreshTokenRepoInput {
  tokenHash: string;
  userId: string;
  sessionId: string;
  expiresAt: string;
  ttl?: number;
}

export interface FindActiveSessionsOptions {
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface FindActiveSessionsPageResult {
  items: SessionDdbRecord[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export type {
  UserMetaDdbRecord,
  UserProfileDdbRecord,
  SessionDdbRecord,
  OtpDdbRecord,
};
