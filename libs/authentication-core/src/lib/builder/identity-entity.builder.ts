import type { UpdateCommandInput } from '@aws-sdk/lib-dynamodb';

import {
  ENTITY_TYPE_EMAIL_LOOKUP,
  ENTITY_TYPE_OTP,
  ENTITY_TYPE_PHONE_LOOKUP,
  ENTITY_TYPE_PROFILE,
  ENTITY_TYPE_REFRESH_TOKEN_LOOKUP,
  ENTITY_TYPE_SESSION,
  ENTITY_TYPE_USER,
  ENTITY_TYPE_USERNAME_LOOKUP,
  INITIAL_USER_VERSION,
  SESSION_STATUS,
  USER_STATUS,
} from '../constants/identity.constants';
import type {
  CreateSessionRepoInput,
  CreateUserRepoInput,
  SaveOtpRepoInput,
  SaveProfileRepoInput,
  SaveRefreshTokenRepoInput,
} from '../persistence/identity-repository.types';
import type {
  EmailLookupDdbRecord,
  OtpDdbRecord,
  PhoneLookupDdbRecord,
  RefreshTokenLookupDdbRecord,
  SessionDdbRecord,
  UserMetaDdbRecord,
  UserProfileDdbRecord,
  UsernameLookupDdbRecord,
} from '../persistence/identity-ddb.model';
import { IdentityKeyBuilder } from './identity-key.builder';

function nowIso(): string {
  return new Date().toISOString();
}

export class IdentityEntityBuilder {
  static buildUserMeta(input: CreateUserRepoInput): UserMetaDdbRecord {
    const timestamp = nowIso();
    const pk = IdentityKeyBuilder.toUserPk(input.userId);
    const status = input.status ?? USER_STATUS.ACTIVE;

    return {
      pk,
      sk: IdentityKeyBuilder.toUserMetaSk(),
      entityType: ENTITY_TYPE_USER,
      userId: input.userId,
      email: IdentityKeyBuilder.normalizeEmail(input.email),
      username: IdentityKeyBuilder.normalizeUsername(input.username),
      phoneNumber: IdentityKeyBuilder.normalizePhone(input.phoneNumber),
      passwordHash: input.passwordHash,
      roleId: input.roleId,
      status,
      emailVerified: false,
      phoneVerified: false,
      version: INITIAL_USER_VERSION,
      gsi4pk: IdentityKeyBuilder.buildGsi4Pk(status),
      gsi4sk: IdentityKeyBuilder.buildGsi4Sk(timestamp, input.userId),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildEmailLookup(userId: string, email: string): EmailLookupDdbRecord {
    const timestamp = nowIso();
    const normalizedEmail = IdentityKeyBuilder.normalizeEmail(email);

    return {
      pk: IdentityKeyBuilder.toEmailLookupPk(normalizedEmail),
      sk: IdentityKeyBuilder.toLookupSk(),
      entityType: ENTITY_TYPE_EMAIL_LOOKUP,
      email: normalizedEmail,
      userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildPhoneLookup(
    userId: string,
    phoneNumber: string,
  ): PhoneLookupDdbRecord {
    const timestamp = nowIso();
    const normalizedPhone = IdentityKeyBuilder.normalizePhone(phoneNumber);

    return {
      pk: IdentityKeyBuilder.toPhoneLookupPk(normalizedPhone),
      sk: IdentityKeyBuilder.toLookupSk(),
      entityType: ENTITY_TYPE_PHONE_LOOKUP,
      phoneNumber: normalizedPhone,
      userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildUsernameLookup(
    userId: string,
    username: string,
  ): UsernameLookupDdbRecord {
    const timestamp = nowIso();
    const normalizedUsername = IdentityKeyBuilder.normalizeUsername(username);

    return {
      pk: IdentityKeyBuilder.toUsernameLookupPk(normalizedUsername),
      sk: IdentityKeyBuilder.toLookupSk(),
      entityType: ENTITY_TYPE_USERNAME_LOOKUP,
      username: normalizedUsername,
      userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildProfile(input: SaveProfileRepoInput): UserProfileDdbRecord {
    const timestamp = nowIso();

    return {
      pk: IdentityKeyBuilder.toUserPk(input.userId),
      sk: IdentityKeyBuilder.toUserProfileSk(),
      entityType: ENTITY_TYPE_PROFILE,
      userId: input.userId,
      firstName: input.firstName,
      lastName: input.lastName,
      profileImageUrl: input.profileImageUrl,
      language: input.language,
      timezone: input.timezone,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildSession(input: CreateSessionRepoInput): SessionDdbRecord {
    const timestamp = nowIso();

    return {
      pk: IdentityKeyBuilder.toUserPk(input.userId),
      sk: IdentityKeyBuilder.toSessionSk(input.sessionId),
      entityType: ENTITY_TYPE_SESSION,
      sessionId: input.sessionId,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      device: input.device,
      ipAddress: input.ipAddress,
      status: SESSION_STATUS.ACTIVE,
      expiresAt: input.expiresAt,
      ttl: input.ttl,
      gsi2pk: IdentityKeyBuilder.buildGsi2Pk(input.refreshTokenHash),
      gsi2sk: IdentityKeyBuilder.buildGsi2Sk(input.userId, input.sessionId),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildRefreshTokenLookup(
    input: SaveRefreshTokenRepoInput,
  ): RefreshTokenLookupDdbRecord {
    const timestamp = nowIso();

    return {
      pk: IdentityKeyBuilder.toRefreshLookupPk(input.tokenHash),
      sk: IdentityKeyBuilder.toRefreshLookupSk(),
      entityType: ENTITY_TYPE_REFRESH_TOKEN_LOOKUP,
      tokenHash: input.tokenHash,
      userId: input.userId,
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
      ttl: input.ttl,
      gsi2pk: IdentityKeyBuilder.buildGsi2Pk(input.tokenHash),
      gsi2sk: IdentityKeyBuilder.buildGsi2Sk(input.userId, input.sessionId),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildOtp(input: SaveOtpRepoInput): OtpDdbRecord {
    const timestamp = nowIso();

    return {
      pk: IdentityKeyBuilder.toUserPk(input.userId),
      sk: IdentityKeyBuilder.toOtpSk(input.purpose),
      entityType: ENTITY_TYPE_OTP,
      otpId: input.otpId,
      userId: input.userId,
      purpose: input.purpose,
      referenceId: input.referenceId,
      codeHash: input.codeHash,
      attempts: 0,
      verified: false,
      expiresAt: input.expiresAt,
      ttl: input.ttl,
      gsi3pk: IdentityKeyBuilder.buildGsi3Pk(input.referenceId),
      gsi3sk: IdentityKeyBuilder.buildGsi3Sk(input.userId, input.purpose),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  static buildStatusUpdateParams(
    table: string,
    userId: string,
    expectedStatus: string,
    targetStatus: string,
  ): UpdateCommandInput {
    const timestamp = nowIso();

    return {
      TableName: table,
      Key: {
        pk: IdentityKeyBuilder.toUserPk(userId),
        sk: IdentityKeyBuilder.toUserMetaSk(),
      },
      UpdateExpression:
        'SET #status = :targetStatus, updatedAt = :updatedAt, gsi4pk = :gsi4pk, gsi4sk = :gsi4sk ADD #ver :one',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#ver': 'version',
      },
      ExpressionAttributeValues: {
        ':targetStatus': targetStatus,
        ':expectedStatus': expectedStatus,
        ':updatedAt': timestamp,
        ':gsi4pk': IdentityKeyBuilder.buildGsi4Pk(targetStatus),
        ':gsi4sk': IdentityKeyBuilder.buildGsi4Sk(timestamp, userId),
        ':one': 1,
      },
      ConditionExpression: '#status = :expectedStatus',
    };
  }
}
