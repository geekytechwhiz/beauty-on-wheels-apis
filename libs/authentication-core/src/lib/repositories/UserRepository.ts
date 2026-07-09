import type {
  TransactWriteCommandInput,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { BaseRepository, ConditionalWriteConflictError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { IdentityEntityBuilder } from '../builder/identity-entity.builder';
import { IdentityKeyBuilder } from '../builder/identity-key.builder';
import { assertIdentityTable } from '../config/assert-identity-table';
import {
  USER_META_SK,
  USER_PROFILE_SK,
  USER_STATUS,
  type UserStatus,
} from '../constants/identity.constants';
import {
  isEmailLookupConditionalFailure,
  isPhoneLookupConditionalFailure,
  isProfileConditionalFailure,
  isUserMetaConditionalFailure,
  isUsernameLookupConditionalFailure,
} from '../constants/identity-transact.constants';
import {
  DuplicateEmailError,
  DuplicatePhoneError,
  DuplicateUsernameError,
  OptimisticLockConflictError,
  UserNotFoundError,
} from '../errors/identity.errors';
import type {
  EmailLookupDdbRecord,
  PhoneLookupDdbRecord,
  UserMetaDdbRecord,
  UserProfileDdbRecord,
  UsernameLookupDdbRecord,
} from '../persistence/identity-ddb.model';
import type {
  CreateUserRepoInput,
  SaveProfileRepoInput,
  UpdateProfileRepoInput,
  UpdateUserRepoInput,
} from '../persistence/identity-repository.types';
import { isDynamoConditionalFailure } from '../utils/dynamodb-error.util';

const baseLogger = createLogger({
  service: 'identity-repository',
  redactPII: true,
});

/**
 * DynamoDB data access for identity user records, lookups, and profiles.
 */
export class UserRepository extends BaseRepository {
  /**
   * Atomically creates a user meta row and uniqueness lookup rows.
   *
   * @param input - User creation payload including credentials and optional profile.
   * @returns Persisted user meta record.
   * @throws DuplicateEmailError | DuplicatePhoneError | DuplicateUsernameError on lookup conflict.
   */
  async createUser(input: CreateUserRepoInput): Promise<UserMetaDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'createUser',
      userId: input.userId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const userMeta = IdentityEntityBuilder.buildUserMeta(input);
    const transactItems: NonNullable<
      TransactWriteCommandInput['TransactItems']
    > = [
      {
        Put: {
          TableName: table,
          Item: userMeta,
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
      {
        Put: {
          TableName: table,
          Item: IdentityEntityBuilder.buildEmailLookup(
            input.userId,
            input.email,
          ),
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
      {
        Put: {
          TableName: table,
          Item: IdentityEntityBuilder.buildPhoneLookup(
            input.userId,
            input.phoneNumber,
          ),
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
      {
        Put: {
          TableName: table,
          Item: IdentityEntityBuilder.buildUsernameLookup(
            input.userId,
            input.username,
          ),
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
    ];

    if (input.profile) {
      transactItems.push({
        Put: {
          TableName: table,
          Item: IdentityEntityBuilder.buildProfile({
            ...input.profile,
            userId: input.userId,
          }),
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      });
    }

    try {
      await this.transactWrite({ TransactItems: transactItems });
      log.info({ event: 'repository_success' });
      return userMeta;
    } catch (err: unknown) {
      log.warn({ event: 'repository_failure', error: String(err) });
      this.rethrowCreateUserConflict(err, input);
      throw err;
    }
  }

  /**
   * Updates mutable user meta fields with optimistic locking on version.
   *
   * @param input - Fields to update and expected version.
   * @returns Updated user meta record.
   * @throws UserNotFoundError when user does not exist.
   * @throws OptimisticLockConflictError on version mismatch.
   */
  async updateUser(input: UpdateUserRepoInput): Promise<UserMetaDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'updateUser',
      userId: input.userId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();
    const sets: string[] = ['updatedAt = :updatedAt', '#ver = :nextVer'];
    const names: Record<string, string> = {
      '#ver': 'version',
    };
    const values: Record<string, unknown> = {
      ':expectedVer': input.expectedVersion,
      ':nextVer': input.expectedVersion + 1,
      ':updatedAt': timestamp,
    };

    if (input.email !== undefined) {
      sets.push('email = :email');
      values[':email'] = IdentityKeyBuilder.normalizeEmail(input.email);
    }
    if (input.username !== undefined) {
      sets.push('username = :username');
      values[':username'] = IdentityKeyBuilder.normalizeUsername(
        input.username,
      );
    }
    if (input.phoneNumber !== undefined) {
      sets.push('phoneNumber = :phoneNumber');
      values[':phoneNumber'] = IdentityKeyBuilder.normalizePhone(
        input.phoneNumber,
      );
    }
    if (input.roleId !== undefined) {
      sets.push('roleId = :roleId');
      values[':roleId'] = input.roleId;
    }

    const params: UpdateCommandInput = {
      TableName: table,
      Key: {
        pk: IdentityKeyBuilder.toUserPk(input.userId),
        sk: USER_META_SK,
      },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: '#ver = :expectedVer',
      ReturnValues: 'ALL_NEW',
    };

    try {
      await this.update(params);
      const updated = await this.findByUserId(input.userId);
      if (!updated) {
        throw new UserNotFoundError(input.userId);
      }
      log.info({ event: 'repository_success' });
      return updated;
    } catch (err: unknown) {
      if (isDynamoConditionalFailure(err)) {
        log.warn({ event: 'repository_conditional_failure' });
        throw new OptimisticLockConflictError('User', input.userId);
      }
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Deletes a user meta row, profile, and all lookup rows atomically.
   *
   * @param userId - User identifier.
   * @throws UserNotFoundError when user meta does not exist.
   */
  async deleteUser(userId: string): Promise<void> {
    const log = createChildLogger(baseLogger, {
      operation: 'deleteUser',
      userId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const user = await this.findByUserId(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const transactItems: NonNullable<
      TransactWriteCommandInput['TransactItems']
    > = [
      {
        Delete: {
          TableName: table,
          Key: {
            pk: IdentityKeyBuilder.toUserPk(userId),
            sk: USER_META_SK,
          },
        },
      },
      {
        Delete: {
          TableName: table,
          Key: {
            pk: IdentityKeyBuilder.toUserPk(userId),
            sk: USER_PROFILE_SK,
          },
        },
      },
      {
        Delete: {
          TableName: table,
          Key: {
            pk: IdentityKeyBuilder.toEmailLookupPk(user.email),
            sk: IdentityKeyBuilder.toLookupSk(),
          },
        },
      },
      {
        Delete: {
          TableName: table,
          Key: {
            pk: IdentityKeyBuilder.toPhoneLookupPk(user.phoneNumber),
            sk: IdentityKeyBuilder.toLookupSk(),
          },
        },
      },
      {
        Delete: {
          TableName: table,
          Key: {
            pk: IdentityKeyBuilder.toUsernameLookupPk(user.username),
            sk: IdentityKeyBuilder.toLookupSk(),
          },
        },
      },
    ];

    try {
      await this.transactWrite({ TransactItems: transactItems });
      log.info({ event: 'repository_success' });
    } catch (err: unknown) {
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Loads a user meta record by user id.
   *
   * @param userId - User identifier.
   * @returns User meta record or null when not found.
   */
  async findByUserId(userId: string): Promise<UserMetaDdbRecord | null> {
    const table = assertIdentityTable();
    return this.get<UserMetaDdbRecord>(table, {
      pk: IdentityKeyBuilder.toUserPk(userId),
      sk: USER_META_SK,
    });
  }

  /**
   * Resolves a user by normalized email via lookup item.
   *
   * @param email - Email address.
   * @returns User meta record or null when not found.
   */
  async findByEmail(email: string): Promise<UserMetaDdbRecord | null> {
    const userId = await this.resolveUserIdFromEmail(email);
    if (!userId) {
      return null;
    }
    return this.findByUserId(userId);
  }

  /**
   * Resolves a user by normalized phone via lookup item.
   *
   * @param phoneNumber - Phone number.
   * @returns User meta record or null when not found.
   */
  async findByPhone(phoneNumber: string): Promise<UserMetaDdbRecord | null> {
    const userId = await this.resolveUserIdFromPhone(phoneNumber);
    if (!userId) {
      return null;
    }
    return this.findByUserId(userId);
  }

  /**
   * Resolves a user by normalized username via lookup item.
   *
   * @param username - Username.
   * @returns User meta record or null when not found.
   */
  async findByUsername(username: string): Promise<UserMetaDdbRecord | null> {
    const userId = await this.resolveUserIdFromUsername(username);
    if (!userId) {
      return null;
    }
    return this.findByUserId(userId);
  }

  /**
   * Checks whether an email lookup already exists.
   *
   * @param email - Email address.
   */
  async existsByEmail(email: string): Promise<boolean> {
    return this.lookupExists(
      IdentityKeyBuilder.toEmailLookupPk(email),
      IdentityKeyBuilder.toLookupSk(),
    );
  }

  /**
   * Checks whether a phone lookup already exists.
   *
   * @param phoneNumber - Phone number.
   */
  async existsByPhone(phoneNumber: string): Promise<boolean> {
    return this.lookupExists(
      IdentityKeyBuilder.toPhoneLookupPk(phoneNumber),
      IdentityKeyBuilder.toLookupSk(),
    );
  }

  /**
   * Checks whether a username lookup already exists.
   *
   * @param username - Username.
   */
  async existsByUsername(username: string): Promise<boolean> {
    return this.lookupExists(
      IdentityKeyBuilder.toUsernameLookupPk(username),
      IdentityKeyBuilder.toLookupSk(),
    );
  }

  /**
   * Activates a user (status → active).
   *
   * @param userId - User identifier.
   * @throws UserNotFoundError when user does not exist.
   * @throws OptimisticLockConflictError on status mismatch.
   */
  async activateUser(userId: string): Promise<UserMetaDdbRecord> {
    return this.transitionStatus(
      userId,
      USER_STATUS.INACTIVE,
      USER_STATUS.ACTIVE,
      'activateUser',
    );
  }

  /**
   * Deactivates a user (status → inactive).
   *
   * @param userId - User identifier.
   * @throws UserNotFoundError when user does not exist.
   * @throws OptimisticLockConflictError on status mismatch.
   */
  async deactivateUser(userId: string): Promise<UserMetaDdbRecord> {
    return this.transitionStatus(
      userId,
      USER_STATUS.ACTIVE,
      USER_STATUS.INACTIVE,
      'deactivateUser',
    );
  }

  /**
   * Suspends a user (status → suspended).
   *
   * @param userId - User identifier.
   * @throws UserNotFoundError when user does not exist.
   * @throws OptimisticLockConflictError on status mismatch.
   */
  async suspendUser(userId: string): Promise<UserMetaDdbRecord> {
    const user = await this.findByUserId(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }
    return this.transitionStatus(
      userId,
      user.status,
      USER_STATUS.SUSPENDED,
      'suspendUser',
    );
  }

  /**
   * Updates the stored password hash for a user.
   *
   * @param userId - User identifier.
   * @param passwordHash - Pre-hashed password value.
   * @param expectedVersion - Expected user version for optimistic locking.
   * @throws OptimisticLockConflictError on version mismatch.
   */
  async updatePassword(
    userId: string,
    passwordHash: string,
    expectedVersion: number,
  ): Promise<UserMetaDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'updatePassword',
      userId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();

    try {
      await this.update({
        TableName: table,
        Key: {
          pk: IdentityKeyBuilder.toUserPk(userId),
          sk: USER_META_SK,
        },
        UpdateExpression:
          'SET passwordHash = :passwordHash, updatedAt = :updatedAt, #ver = :nextVer',
        ExpressionAttributeNames: { '#ver': 'version' },
        ExpressionAttributeValues: {
          ':passwordHash': passwordHash,
          ':updatedAt': timestamp,
          ':expectedVer': expectedVersion,
          ':nextVer': expectedVersion + 1,
        },
        ConditionExpression: '#ver = :expectedVer',
      });

      const updated = await this.findByUserId(userId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }
      log.info({ event: 'repository_success' });
      return updated;
    } catch (err: unknown) {
      if (isDynamoConditionalFailure(err)) {
        log.warn({ event: 'repository_conditional_failure' });
        throw new OptimisticLockConflictError('User', userId);
      }
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Marks a user's email as verified.
   *
   * @param userId - User identifier.
   */
  async verifyEmail(userId: string): Promise<UserMetaDdbRecord> {
    return this.setVerificationFlag(userId, 'emailVerified', 'verifyEmail');
  }

  /**
   * Marks a user's phone as verified.
   *
   * @param userId - User identifier.
   */
  async verifyPhone(userId: string): Promise<UserMetaDdbRecord> {
    return this.setVerificationFlag(userId, 'phoneVerified', 'verifyPhone');
  }

  /**
   * Assigns a role to a user.
   *
   * @param userId - User identifier.
   * @param roleId - Role identifier.
   * @param expectedVersion - Expected user version.
   */
  async assignRole(
    userId: string,
    roleId: string,
    expectedVersion: number,
  ): Promise<UserMetaDdbRecord> {
    return this.updateUser({ userId, expectedVersion, roleId });
  }

  /**
   * Removes a user's role assignment.
   *
   * @param userId - User identifier.
   * @param expectedVersion - Expected user version.
   */
  async removeRole(
    userId: string,
    expectedVersion: number,
  ): Promise<UserMetaDdbRecord> {
    return this.updateUser({ userId, expectedVersion, roleId: '' });
  }

  /**
   * Partially updates a user profile record.
   *
   * @param input - Profile fields to update.
   * @returns Updated profile or null when profile does not exist.
   */
  async updateProfile(
    input: UpdateProfileRepoInput,
  ): Promise<UserProfileDdbRecord | null> {
    const log = createChildLogger(baseLogger, {
      operation: 'updateProfile',
      userId: input.userId,
    });
    log.info({ event: 'repository_start' });

    const existing = await this.findProfile(input.userId);
    if (!existing) {
      log.info({ event: 'repository_success', found: false });
      return null;
    }

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();
    const sets: string[] = ['updatedAt = :updatedAt'];
    const values: Record<string, unknown> = { ':updatedAt': timestamp };

    const fields: Array<keyof UpdateProfileRepoInput> = [
      'firstName',
      'lastName',
      'profileImageUrl',
      'language',
      'timezone',
    ];

    for (const field of fields) {
      if (input[field] !== undefined) {
        sets.push(`${field} = :${field}`);
        values[`:${field}`] = input[field];
      }
    }

    await this.update({
      TableName: table,
      Key: {
        pk: IdentityKeyBuilder.toUserPk(input.userId),
        sk: USER_PROFILE_SK,
      },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeValues: values,
    });

    log.info({ event: 'repository_success' });
    return this.findProfile(input.userId);
  }

  /**
   * Loads a user profile by user id.
   *
   * @param userId - User identifier.
   */
  async findProfile(userId: string): Promise<UserProfileDdbRecord | null> {
    const table = assertIdentityTable();
    return this.get<UserProfileDdbRecord>(table, {
      pk: IdentityKeyBuilder.toUserPk(userId),
      sk: USER_PROFILE_SK,
    });
  }

  /**
   * Creates a user profile record.
   *
   * @param input - Profile payload.
   * @returns Persisted profile record.
   * @throws ConditionalWriteConflictError when profile already exists.
   */
  async saveProfile(
    input: SaveProfileRepoInput,
  ): Promise<UserProfileDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'saveProfile',
      userId: input.userId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const profile = IdentityEntityBuilder.buildProfile(input);

    try {
      await this.put(table, profile, 'attribute_not_exists(pk)');
      log.info({ event: 'repository_success' });
      return profile;
    } catch (err: unknown) {
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  private async lookupExists(pk: string, sk: string): Promise<boolean> {
    const table = assertIdentityTable();
    const item = await this.get<{ pk: string }>(table, { pk, sk });
    return item !== null;
  }

  private async resolveUserIdFromEmail(email: string): Promise<string | null> {
    const table = assertIdentityTable();
    const lookup = await this.get<EmailLookupDdbRecord>(table, {
      pk: IdentityKeyBuilder.toEmailLookupPk(email),
      sk: IdentityKeyBuilder.toLookupSk(),
    });
    return lookup?.userId ?? null;
  }

  private async resolveUserIdFromPhone(
    phoneNumber: string,
  ): Promise<string | null> {
    const table = assertIdentityTable();
    const lookup = await this.get<PhoneLookupDdbRecord>(table, {
      pk: IdentityKeyBuilder.toPhoneLookupPk(phoneNumber),
      sk: IdentityKeyBuilder.toLookupSk(),
    });
    return lookup?.userId ?? null;
  }

  private async resolveUserIdFromUsername(
    username: string,
  ): Promise<string | null> {
    const table = assertIdentityTable();
    const lookup = await this.get<UsernameLookupDdbRecord>(table, {
      pk: IdentityKeyBuilder.toUsernameLookupPk(username),
      sk: IdentityKeyBuilder.toLookupSk(),
    });
    return lookup?.userId ?? null;
  }

  private async transitionStatus(
    userId: string,
    expectedStatus: UserStatus,
    targetStatus: UserStatus,
    operation: string,
  ): Promise<UserMetaDdbRecord> {
    const log = createChildLogger(baseLogger, { operation, userId });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const params = IdentityEntityBuilder.buildStatusUpdateParams(
      table,
      userId,
      expectedStatus,
      targetStatus,
    );

    try {
      await this.update(params);
      const updated = await this.findByUserId(userId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }
      log.info({ event: 'repository_success' });
      return updated;
    } catch (err: unknown) {
      if (isDynamoConditionalFailure(err)) {
        log.warn({ event: 'repository_conditional_failure' });
        throw new OptimisticLockConflictError('User', userId);
      }
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  private async setVerificationFlag(
    userId: string,
    field: 'emailVerified' | 'phoneVerified',
    operation: string,
  ): Promise<UserMetaDdbRecord> {
    const log = createChildLogger(baseLogger, { operation, userId });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();

    try {
      await this.update({
        TableName: table,
        Key: {
          pk: IdentityKeyBuilder.toUserPk(userId),
          sk: USER_META_SK,
        },
        UpdateExpression: `SET ${field} = :true, updatedAt = :updatedAt`,
        ExpressionAttributeValues: {
          ':true': true,
          ':updatedAt': timestamp,
        },
        ConditionExpression: 'attribute_exists(pk)',
      });

      const updated = await this.findByUserId(userId);
      if (!updated) {
        throw new UserNotFoundError(userId);
      }
      log.info({ event: 'repository_success' });
      return updated;
    } catch (err: unknown) {
      if (
        err instanceof ConditionalWriteConflictError ||
        isDynamoConditionalFailure(err)
      ) {
        log.warn({ event: 'repository_conditional_failure' });
        throw new UserNotFoundError(userId);
      }
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  private rethrowCreateUserConflict(
    err: unknown,
    input: CreateUserRepoInput,
  ): void {
    if (isUserMetaConditionalFailure(err)) {
      throw new DuplicateEmailError(input.email);
    }
    if (isEmailLookupConditionalFailure(err)) {
      throw new DuplicateEmailError(input.email);
    }
    if (isPhoneLookupConditionalFailure(err)) {
      throw new DuplicatePhoneError(input.phoneNumber);
    }
    if (isUsernameLookupConditionalFailure(err)) {
      throw new DuplicateUsernameError(input.username);
    }
    if (isProfileConditionalFailure(err)) {
      throw new OptimisticLockConflictError('Profile', input.userId);
    }
  }
}
