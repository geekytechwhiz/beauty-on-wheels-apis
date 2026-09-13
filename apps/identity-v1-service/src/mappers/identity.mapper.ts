import { User, Profile, Session, Otp, Role, Permission, LoginHistory, AuditLog } from '../types/repository.types';
import { UserDdbItem, ProfileDdbItem, SessionDdbItem, OtpDdbItem, RoleDdbItem, PermissionDdbItem, LoginHistoryDdbItem, AuditLogDdbItem } from '../models/dynamodb-item';
import { IdentityKeyBuilder } from '../keys/identity-key.builder';
import { ENTITY_TYPES } from '../constants/identity-index.constant';

/** DynamoDB key / index attributes that must never be returned on the API wire. */
const DDB_INTERNAL_KEYS = new Set([
  'PK',
  'SK',
  'entityType',
  'GSI1PK',
  'GSI1SK',
  'GSI2PK',
  'GSI2SK',
  'GSI5PK',
  'GSI5SK',
]);

export class IdentityMapper {
  /** Returns all item attributes except PK/SK/GSI/entityType. */
  static omitDdbKeys<T extends Record<string, unknown>>(item: T): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!DDB_INTERNAL_KEYS.has(key) && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  static toUserDomain(item: UserDdbItem): User {
    return {
      userId: item.userId,
      email: item.email,
      username: item.username,
      phoneNumber: item.phoneNumber,
      passwordHash: item.passwordHash,
      roleId: item.roleId,
      status: item.status,
      emailVerified: item.emailVerified,
      phoneVerified: item.phoneVerified,
      version: item.version,
      identityId: item.identityId,
      cognitoUsername: item.cognitoUsername,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toUserDdb(user: User, tenantId?: string): UserDdbItem {
    const keys = IdentityKeyBuilder.userMeta(user.userId);
    const timestamp = new Date().toISOString();
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.USER,
      userId: user.userId,
      email: IdentityKeyBuilder.normalizeEmail(user.email),
      username: IdentityKeyBuilder.normalizeUsername(user.username),
      phoneNumber: IdentityKeyBuilder.normalizePhone(user.phoneNumber),
      passwordHash: user.passwordHash,
      roleId: user.roleId,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      version: user.version,
      identityId: user.identityId,
      cognitoUsername: user.cognitoUsername,
      tenantId,
      createdAt: user.createdAt || timestamp,
      updatedAt: timestamp,
      ...(tenantId ? {
        GSI2PK: IdentityKeyBuilder.gsi2Pk(tenantId),
        GSI2SK: IdentityKeyBuilder.gsi2Sk(user.userId),
      } : {}),
    };
  }

  static toProfileDomain(item: ProfileDdbItem): Profile {
    return IdentityMapper.omitDdbKeys(item as unknown as Record<string, unknown>) as unknown as Profile;
  }

  static toProfileDdb(profile: Profile): ProfileDdbItem {
    const keys = IdentityKeyBuilder.userProfile(profile.userId);
    const timestamp = new Date().toISOString();
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.PROFILE,
      userId: profile.userId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      profileImageUrl: profile.profileImageUrl,
      language: profile.language,
      timezone: profile.timezone,
      email: profile.email,
      phoneNumber: profile.phoneNumber,
      createdAt: profile.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }

  static toSessionDomain(item: SessionDdbItem): Session {
    return {
      sessionId: item.sessionId,
      userId: item.userId,
      refreshTokenHash: item.refreshTokenHash,
      device: item.device,
      ipAddress: item.ipAddress,
      status: item.status,
      expiresAt: item.expiresAt,
      ttl: item.ttl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toSessionDdb(session: Session): SessionDdbItem {
    const keys = IdentityKeyBuilder.userSession(session.userId, session.sessionId);
    const timestamp = new Date().toISOString();
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.SESSION,
      sessionId: session.sessionId,
      userId: session.userId,
      refreshTokenHash: session.refreshTokenHash,
      device: session.device,
      ipAddress: session.ipAddress,
      status: session.status,
      expiresAt: session.expiresAt,
      ttl: session.ttl,
      createdAt: session.createdAt || timestamp,
      updatedAt: timestamp,
      GSI5PK: `REFRESH#${session.refreshTokenHash}`,
      GSI5SK: `USER#${session.userId}#SESSION#${session.sessionId}`,
    };
  }

  static toOtpDomain(item: OtpDdbItem): Otp {
    return {
      otpId: item.otpId,
      destination: item.destination,
      purpose: item.purpose,
      referenceId: item.referenceId,
      codeHash: item.codeHash,
      attempts: item.attempts,
      verified: item.verified,
      expiresAt: item.expiresAt,
      ttl: item.ttl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toOtpDdb(otp: Otp): OtpDdbItem {
    const keys = IdentityKeyBuilder.otp(otp.destination, otp.purpose);
    const timestamp = new Date().toISOString();
    const destination = IdentityKeyBuilder.normalizeDestination(otp.destination);
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.OTP,
      otpId: otp.otpId,
      destination,
      purpose: otp.purpose,
      referenceId: otp.referenceId,
      codeHash: otp.codeHash,
      attempts: otp.attempts,
      verified: otp.verified,
      expiresAt: otp.expiresAt,
      ttl: otp.ttl,
      createdAt: otp.createdAt || timestamp,
      updatedAt: timestamp,
      GSI1PK: `OTP_REF#${otp.referenceId}`,
      GSI1SK: `${keys.PK}#${otp.purpose}`,
    };
  }

  static toRoleDomain(item: RoleDdbItem): Role {
    return {
      roleId: item.roleId,
      name: item.name,
      description: item.description,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toRoleDdb(role: Role): RoleDdbItem {
    const keys = IdentityKeyBuilder.role(role.roleId);
    const timestamp = new Date().toISOString();
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.ROLE,
      roleId: role.roleId,
      name: role.name,
      description: role.description,
      createdAt: role.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }

  static toPermissionDomain(item: PermissionDdbItem): Permission {
    return {
      roleId: item.roleId,
      permissionId: item.permissionId,
      name: item.name,
      description: item.description,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toPermissionDdb(permission: Permission): PermissionDdbItem {
    const keys = IdentityKeyBuilder.permission(permission.roleId, permission.permissionId);
    const timestamp = new Date().toISOString();
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.PERMISSION,
      roleId: permission.roleId,
      permissionId: permission.permissionId,
      name: permission.name,
      description: permission.description,
      createdAt: permission.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }

  static toLoginHistoryDomain(item: LoginHistoryDdbItem): LoginHistory {
    return {
      userId: item.userId,
      timestamp: item.timestamp,
      ipAddress: item.ipAddress,
      userAgent: item.userAgent,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toLoginHistoryDdb(history: LoginHistory): LoginHistoryDdbItem {
    const keys = IdentityKeyBuilder.loginHistory(history.userId, history.timestamp);
    const timestamp = new Date().toISOString();
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.LOGIN_HISTORY,
      userId: history.userId,
      timestamp: history.timestamp,
      ipAddress: history.ipAddress,
      userAgent: history.userAgent,
      status: history.status,
      createdAt: history.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }

  static toAuditDomain(item: AuditLogDdbItem): AuditLog {
    return {
      auditId: item.auditId,
      userId: item.userId,
      action: item.action,
      details: item.details,
      timestamp: item.timestamp,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toAuditDdb(audit: AuditLog): AuditLogDdbItem {
    const keys = IdentityKeyBuilder.auditLog(audit.auditId);
    const timestamp = new Date().toISOString();
    return {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.AUDIT,
      auditId: audit.auditId,
      userId: audit.userId,
      action: audit.action,
      details: audit.details,
      timestamp: audit.timestamp,
      createdAt: audit.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }
}
