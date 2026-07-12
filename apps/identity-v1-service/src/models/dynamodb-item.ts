export interface BaseDdbItem {
  PK: string;
  SK: string;
  entityType: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  GSI5PK?: string;
  GSI5SK?: string;
}

export interface UserDdbItem extends BaseDdbItem {
  userId: string;
  email: string;
  username: string;
  phoneNumber: string;
  passwordHash: string;
  roleId?: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  version: number;
  tenantId?: string; // used for listUsersByTenant access pattern
}

export interface ProfileDdbItem extends BaseDdbItem {
  userId: string;
  firstName: string;
  lastName: string;
  profileImageUrl?: string;
  language?: string;
  timezone?: string;
}

export interface LookupDdbItem extends BaseDdbItem {
  userId: string;
  email?: string;
  phoneNumber?: string;
  username?: string;
}

export interface SessionDdbItem extends BaseDdbItem {
  sessionId: string;
  userId: string;
  refreshTokenHash: string;
  device?: string;
  ipAddress?: string;
  status: string;
  expiresAt: string;
  ttl?: number;
}

export interface RefreshTokenLookupDdbItem extends BaseDdbItem {
  tokenHash: string;
  userId: string;
  sessionId: string;
  expiresAt: string;
  ttl?: number;
}

export interface OtpDdbItem extends BaseDdbItem {
  otpId: string;
  userId: string;
  purpose: string;
  referenceId: string;
  codeHash: string;
  attempts: number;
  verified: boolean;
  expiresAt: string;
  ttl?: number;
}

export interface RoleDdbItem extends BaseDdbItem {
  roleId: string;
  name: string;
  description?: string;
}

export interface PermissionDdbItem extends BaseDdbItem {
  roleId: string;
  permissionId: string;
  name: string;
  description?: string;
}

export interface LoginHistoryDdbItem extends BaseDdbItem {
  userId: string;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  status: string;
}

export interface AuditLogDdbItem extends BaseDdbItem {
  auditId: string;
  userId: string;
  action: string;
  details?: string;
  timestamp: string;
}

export type IdentityDdbItem =
  | UserDdbItem
  | ProfileDdbItem
  | LookupDdbItem
  | SessionDdbItem
  | RefreshTokenLookupDdbItem
  | OtpDdbItem
  | RoleDdbItem
  | PermissionDdbItem
  | LoginHistoryDdbItem
  | AuditLogDdbItem;
