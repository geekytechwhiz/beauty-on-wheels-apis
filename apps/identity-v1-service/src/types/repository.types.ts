import { BaseError } from '@api-hub/utils';

export interface User {
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
  createdAt?: string;
  updatedAt?: string;
}

export interface Profile {
  userId: string;
  firstName: string;
  lastName: string;
  profileImageUrl?: string;
  language?: string;
  timezone?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Session {
  sessionId: string;
  userId: string;
  refreshTokenHash: string;
  device?: string;
  ipAddress?: string;
  status: string;
  expiresAt: string;
  ttl?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Otp {
  otpId: string;
  userId: string;
  purpose: string;
  referenceId: string;
  codeHash: string;
  attempts: number;
  verified: boolean;
  expiresAt: string;
  ttl?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Role {
  roleId: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Permission {
  roleId: string;
  permissionId: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoginHistory {
  userId: string;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  auditId: string;
  userId: string;
  action: string;
  details?: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
}

export class UserAlreadyExistsException extends BaseError {
  constructor(message: string) {
    super(message, 409, 'USER_ALREADY_EXISTS');
    this.name = 'UserAlreadyExistsException';
  }
}

export class SessionNotFoundException extends BaseError {
  constructor(message: string) {
    super(message, 404, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundException';
  }
}

export class InvalidRefreshTokenException extends BaseError {
  constructor(message: string) {
    super(message, 401, 'INVALID_REFRESH_TOKEN');
    this.name = 'InvalidRefreshTokenException';
  }
}

export class RoleNotFoundException extends BaseError {
  constructor(message: string) {
    super(message, 404, 'ROLE_NOT_FOUND');
    this.name = 'RoleNotFoundException';
  }
}
