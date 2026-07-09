import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { BaseRepository } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { IdentityEntityBuilder } from '../builder/identity-entity.builder';
import { IdentityKeyBuilder } from '../builder/identity-key.builder';
import { assertIdentityTable } from '../config/assert-identity-table';
import {
  GSI2_REFRESH_TOKEN,
  GSI3_OTP_REFERENCE,
  SESSION_SK_PREFIX,
  SESSION_STATUS,
} from '../constants/identity.constants';
import {
  OtpNotFoundError,
  SessionNotFoundError,
} from '../errors/identity.errors';
import type {
  OtpDdbRecord,
  SessionDdbRecord,
} from '../persistence/identity-ddb.model';
import type {
  CreateSessionRepoInput,
  FindActiveSessionsOptions,
  FindActiveSessionsPageResult,
  SaveOtpRepoInput,
  SaveRefreshTokenRepoInput,
} from '../persistence/identity-repository.types';
import { isDynamoConditionalFailure } from '../utils/dynamodb-error.util';

const baseLogger = createLogger({
  service: 'identity-repository',
  redactPII: true,
});

const REVOKE_BATCH_SIZE = 25;

/**
 * DynamoDB data access for sessions, OTP records, and refresh token lookups.
 */
export class AuthenticationRepository extends BaseRepository {
  /**
   * Atomically creates a session and its refresh token lookup row.
   *
   * @param input - Session creation payload.
   * @returns Persisted session record.
   */
  async createSession(
    input: CreateSessionRepoInput,
  ): Promise<SessionDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'createSession',
      userId: input.userId,
      sessionId: input.sessionId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const session = IdentityEntityBuilder.buildSession(input);
    const refreshLookup = IdentityEntityBuilder.buildRefreshTokenLookup({
      tokenHash: input.refreshTokenHash,
      userId: input.userId,
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
      ttl: input.ttl,
    });

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: session,
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: refreshLookup,
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
        ],
      });
      log.info({ event: 'repository_success' });
      return session;
    } catch (err: unknown) {
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Loads a session by user id and session id.
   *
   * @param userId - User identifier.
   * @param sessionId - Session identifier.
   * @returns Session record or null when not found.
   */
  async findSession(
    userId: string,
    sessionId: string,
  ): Promise<SessionDdbRecord | null> {
    const table = assertIdentityTable();
    return this.get<SessionDdbRecord>(table, {
      pk: IdentityKeyBuilder.toUserPk(userId),
      sk: IdentityKeyBuilder.toSessionSk(sessionId),
    });
  }

  /**
   * Lists active sessions for a user with optional pagination.
   *
   * @param userId - User identifier.
   * @param options - Pagination options.
   */
  async findActiveSessions(
    userId: string,
    options: FindActiveSessionsOptions = {},
  ): Promise<FindActiveSessionsPageResult> {
    const table = assertIdentityTable();

    if (
      options.limit !== undefined ||
      options.exclusiveStartKey !== undefined
    ) {
      const page = await this.queryPage<SessionDdbRecord>({
        TableName: table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': IdentityKeyBuilder.toUserPk(userId),
          ':skPrefix': SESSION_SK_PREFIX,
          ':active': SESSION_STATUS.ACTIVE,
        },
        Limit: options.limit,
        ExclusiveStartKey: options.exclusiveStartKey,
      });

      return {
        items: page.items,
        lastEvaluatedKey: page.lastEvaluatedKey,
      };
    }

    const items = await this.query<SessionDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': IdentityKeyBuilder.toUserPk(userId),
        ':skPrefix': SESSION_SK_PREFIX,
        ':active': SESSION_STATUS.ACTIVE,
      },
    });

    return { items };
  }

  /**
   * Resolves a session by refresh token hash via GSI2.
   *
   * @param tokenHash - Hashed refresh token value.
   * @returns Session record or null when not found.
   */
  async findSessionByRefreshToken(
    tokenHash: string,
  ): Promise<SessionDdbRecord | null> {
    const table = assertIdentityTable();
    const gsiItem = await this.queryOne<SessionDdbRecord>({
      TableName: table,
      IndexName: GSI2_REFRESH_TOKEN,
      KeyConditionExpression: 'gsi2pk = :gsi2pk',
      ExpressionAttributeValues: {
        ':gsi2pk': IdentityKeyBuilder.buildGsi2Pk(tokenHash),
      },
    });

    if (!gsiItem) {
      return null;
    }

    return this.findSession(gsiItem.userId, gsiItem.sessionId);
  }

  /**
   * Revokes a single active session.
   *
   * @param userId - User identifier.
   * @param sessionId - Session identifier.
   * @throws SessionNotFoundError when session is missing or not active.
   */
  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<SessionDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'revokeSession',
      userId,
      sessionId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();

    try {
      await this.update({
        TableName: table,
        Key: {
          pk: IdentityKeyBuilder.toUserPk(userId),
          sk: IdentityKeyBuilder.toSessionSk(sessionId),
        },
        UpdateExpression: 'SET #status = :revoked, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':revoked': SESSION_STATUS.REVOKED,
          ':active': SESSION_STATUS.ACTIVE,
          ':updatedAt': timestamp,
        },
        ConditionExpression: '#status = :active',
      });

      const session = await this.findSession(userId, sessionId);
      if (!session) {
        throw new SessionNotFoundError(userId, sessionId);
      }
      log.info({ event: 'repository_success' });
      return session;
    } catch (err: unknown) {
      if (isDynamoConditionalFailure(err)) {
        log.warn({ event: 'repository_conditional_failure' });
        throw new SessionNotFoundError(userId, sessionId);
      }
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Revokes all active sessions for a user in batched transactions.
   *
   * @param userId - User identifier.
   * @returns Count of sessions revoked.
   */
  async revokeAllSessions(userId: string): Promise<number> {
    const log = createChildLogger(baseLogger, {
      operation: 'revokeAllSessions',
      userId,
    });
    log.info({ event: 'repository_start' });

    const { items } = await this.findActiveSessions(userId);
    if (items.length === 0) {
      log.info({ event: 'repository_success', revokedCount: 0 });
      return 0;
    }

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();
    let revokedCount = 0;

    for (let i = 0; i < items.length; i += REVOKE_BATCH_SIZE) {
      const chunk = items.slice(i, i + REVOKE_BATCH_SIZE);
      const transactItems: NonNullable<
        TransactWriteCommandInput['TransactItems']
      > = chunk.map((session) => ({
        Update: {
          TableName: table,
          Key: {
            pk: session.pk,
            sk: session.sk,
          },
          UpdateExpression: 'SET #status = :revoked, updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':revoked': SESSION_STATUS.REVOKED,
            ':active': SESSION_STATUS.ACTIVE,
            ':updatedAt': timestamp,
          },
          ConditionExpression: '#status = :active',
        },
      }));

      await this.transactWrite({ TransactItems: transactItems });
      revokedCount += chunk.length;
    }

    log.info({ event: 'repository_success', revokedCount });
    return revokedCount;
  }

  /**
   * Deletes expired sessions and their refresh token lookups for a user.
   *
   * @param userId - User identifier.
   * @param beforeIso - Expiry cutoff (defaults to now).
   * @returns Count of deleted sessions.
   */
  async deleteExpiredSessions(
    userId: string,
    beforeIso?: string,
  ): Promise<number> {
    const log = createChildLogger(baseLogger, {
      operation: 'deleteExpiredSessions',
      userId,
    });
    log.info({ event: 'repository_start' });

    const cutoff = beforeIso ?? new Date().toISOString();
    const table = assertIdentityTable();
    const sessions = await this.queryAll<SessionDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': IdentityKeyBuilder.toUserPk(userId),
        ':skPrefix': SESSION_SK_PREFIX,
      },
    });

    const expired = sessions.filter(
      (session: SessionDdbRecord) => session.expiresAt <= cutoff,
    );
    let deletedCount = 0;

    for (const session of expired) {
      await this.transactWrite({
        TransactItems: [
          {
            Delete: {
              TableName: table,
              Key: { pk: session.pk, sk: session.sk },
            },
          },
          {
            Delete: {
              TableName: table,
              Key: {
                pk: IdentityKeyBuilder.toRefreshLookupPk(
                  session.refreshTokenHash,
                ),
                sk: IdentityKeyBuilder.toRefreshLookupSk(),
              },
            },
          },
        ],
      });
      deletedCount += 1;
    }

    log.info({ event: 'repository_success', deletedCount });
    return deletedCount;
  }

  /**
   * Persists an OTP record for a user and purpose.
   *
   * @param input - OTP payload.
   * @returns Persisted OTP record.
   * @throws ConditionalWriteConflictError when OTP already exists for purpose.
   */
  async saveOtp(input: SaveOtpRepoInput): Promise<OtpDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'saveOtp',
      userId: input.userId,
      purpose: input.purpose,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const otp = IdentityEntityBuilder.buildOtp(input);

    try {
      await this.put(table, otp, 'attribute_not_exists(pk)');
      log.info({ event: 'repository_success' });
      return otp;
    } catch (err: unknown) {
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Loads an OTP by user id and purpose.
   *
   * @param userId - User identifier.
   * @param purpose - OTP purpose key.
   */
  async findOtp(userId: string, purpose: string): Promise<OtpDdbRecord | null> {
    const table = assertIdentityTable();
    return this.get<OtpDdbRecord>(table, {
      pk: IdentityKeyBuilder.toUserPk(userId),
      sk: IdentityKeyBuilder.toOtpSk(purpose),
    });
  }

  /**
   * Resolves an OTP by reference id via GSI3.
   *
   * @param referenceId - External OTP reference identifier.
   */
  async findOtpByReferenceId(
    referenceId: string,
  ): Promise<OtpDdbRecord | null> {
    const table = assertIdentityTable();
    return this.queryOne<OtpDdbRecord>({
      TableName: table,
      IndexName: GSI3_OTP_REFERENCE,
      KeyConditionExpression: 'gsi3pk = :gsi3pk',
      ExpressionAttributeValues: {
        ':gsi3pk': IdentityKeyBuilder.buildGsi3Pk(referenceId),
      },
    });
  }

  /**
   * Deletes an OTP record.
   *
   * @param userId - User identifier.
   * @param purpose - OTP purpose key.
   */
  async deleteOtp(userId: string, purpose: string): Promise<void> {
    const log = createChildLogger(baseLogger, {
      operation: 'deleteOtp',
      userId,
      purpose,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    await this.delete(table, {
      pk: IdentityKeyBuilder.toUserPk(userId),
      sk: IdentityKeyBuilder.toOtpSk(purpose),
    });

    log.info({ event: 'repository_success' });
  }

  /**
   * Increments OTP attempt counter with a max attempts guard.
   *
   * @param userId - User identifier.
   * @param purpose - OTP purpose key.
   * @param maxAttempts - Maximum allowed attempts.
   * @throws OtpNotFoundError when OTP is missing or max attempts exceeded.
   */
  async incrementOtpAttempts(
    userId: string,
    purpose: string,
    maxAttempts: number,
  ): Promise<OtpDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'incrementOtpAttempts',
      userId,
      purpose,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();

    try {
      await this.update({
        TableName: table,
        Key: {
          pk: IdentityKeyBuilder.toUserPk(userId),
          sk: IdentityKeyBuilder.toOtpSk(purpose),
        },
        UpdateExpression: 'ADD attempts :one SET updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':one': 1,
          ':updatedAt': timestamp,
          ':maxAttempts': maxAttempts,
        },
        ConditionExpression: 'attribute_exists(pk) AND attempts < :maxAttempts',
      });

      const otp = await this.findOtp(userId, purpose);
      if (!otp) {
        throw new OtpNotFoundError(userId, purpose);
      }
      log.info({ event: 'repository_success' });
      return otp;
    } catch (err: unknown) {
      if (isDynamoConditionalFailure(err)) {
        log.warn({ event: 'repository_conditional_failure' });
        throw new OtpNotFoundError(userId, purpose);
      }
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Marks an OTP as verified.
   *
   * @param userId - User identifier.
   * @param purpose - OTP purpose key.
   * @throws OtpNotFoundError when OTP does not exist.
   */
  async markOtpVerified(
    userId: string,
    purpose: string,
  ): Promise<OtpDdbRecord> {
    const log = createChildLogger(baseLogger, {
      operation: 'markOtpVerified',
      userId,
      purpose,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const timestamp = new Date().toISOString();

    try {
      await this.update({
        TableName: table,
        Key: {
          pk: IdentityKeyBuilder.toUserPk(userId),
          sk: IdentityKeyBuilder.toOtpSk(purpose),
        },
        UpdateExpression: 'SET verified = :true, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':true': true,
          ':updatedAt': timestamp,
        },
        ConditionExpression: 'attribute_exists(pk)',
      });

      const otp = await this.findOtp(userId, purpose);
      if (!otp) {
        throw new OtpNotFoundError(userId, purpose);
      }
      log.info({ event: 'repository_success' });
      return otp;
    } catch (err: unknown) {
      if (isDynamoConditionalFailure(err)) {
        log.warn({ event: 'repository_conditional_failure' });
        throw new OtpNotFoundError(userId, purpose);
      }
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Persists a refresh token lookup row.
   *
   * @param input - Refresh token lookup payload.
   */
  async saveRefreshToken(input: SaveRefreshTokenRepoInput): Promise<void> {
    const log = createChildLogger(baseLogger, {
      operation: 'saveRefreshToken',
      userId: input.userId,
      sessionId: input.sessionId,
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    const item = IdentityEntityBuilder.buildRefreshTokenLookup(input);

    try {
      await this.put(table, item, 'attribute_not_exists(pk)');
      log.info({ event: 'repository_success' });
    } catch (err: unknown) {
      log.warn({ event: 'repository_failure', error: String(err) });
      throw err;
    }
  }

  /**
   * Deletes a refresh token lookup row by token hash.
   *
   * @param tokenHash - Hashed refresh token value.
   */
  async deleteRefreshToken(tokenHash: string): Promise<void> {
    const log = createChildLogger(baseLogger, {
      operation: 'deleteRefreshToken',
    });
    log.info({ event: 'repository_start' });

    const table = assertIdentityTable();
    await this.delete(table, {
      pk: IdentityKeyBuilder.toRefreshLookupPk(tokenHash),
      sk: IdentityKeyBuilder.toRefreshLookupSk(),
    });

    log.info({ event: 'repository_success' });
  }
}
