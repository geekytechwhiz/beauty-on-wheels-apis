import {
  BaseRepository,
  ConditionalWriteConflictError,
  ddbDocClient,
  sendDoc,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';
import { resolveApplicationRoles } from '@api-hub/authentication-core';
import {
  TABLE_NAME,
  GSI_INDEX_NAMES,
  ENTITY_TYPES,
  PREFIXES,
  SK_VALS,
} from '../constants/identity-index.constant';
import { IdentityKeyBuilder } from '../keys/identity-key.builder';
import { IdentityMapper } from '../mappers/identity.mapper';
import {
  User,
  Profile,
  Session,
  Otp,
  Role,
  Permission,
  LoginHistory,
  AuditLog,
  UserAlreadyExistsException,
} from '../types/repository.types';
import {
  UserDdbItem,
  SessionDdbItem,
  OtpDdbItem,
  RoleDdbItem,
  PermissionDdbItem,
  LoginHistoryDdbItem,
  AuditLogDdbItem,
  RefreshTokenLookupDdbItem,
} from '../models/dynamodb-item';
import {
  QueryCommandInput,
  ScanCommand,
  ScanCommandInput,
  ScanCommandOutput,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';

const baseLogger = createLogger({
  service: 'identity-repository',
  redactPII: false,
});

export class IdentityRepository extends BaseRepository {
  private readonly repoLogger = createChildLogger(baseLogger, {
    service: 'IdentityRepository',
  });

  // --- USER METHODS ---

  async createUser(
    user: User,
    profile?: Profile,
    tenantId?: string,
  ): Promise<User> {
    const log = createChildLogger(this.repoLogger, {
      operation: 'createUser',
      userId: user.userId,
    });
    log.info({ event: 'repository_start' });

    const userDdb = IdentityMapper.toUserDdb(user, tenantId);
    const hasEmail = Boolean(user.email?.trim());
    const hasPhone = Boolean(user.phoneNumber?.trim());
    const hasUsername = Boolean(user.username?.trim());

    const transactItems: any[] = [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: userDdb,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ];

    if (hasEmail) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: IdentityKeyBuilder.userByEmail(user.email).PK,
            SK: IdentityKeyBuilder.userByEmail(user.email).SK,
            entityType: ENTITY_TYPES.EMAIL_LOOKUP,
            userId: user.userId,
            email: IdentityKeyBuilder.normalizeEmail(user.email),
            GSI1PK: IdentityKeyBuilder.userByEmail(user.email).PK,
            GSI1SK: `USER#${user.userId}`,
            createdAt: userDdb.createdAt,
            updatedAt: userDdb.updatedAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    if (hasPhone) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: IdentityKeyBuilder.userByPhone(user.phoneNumber).PK,
            SK: IdentityKeyBuilder.userByPhone(user.phoneNumber).SK,
            entityType: ENTITY_TYPES.PHONE_LOOKUP,
            userId: user.userId,
            phoneNumber: IdentityKeyBuilder.normalizePhone(user.phoneNumber),
            GSI1PK: IdentityKeyBuilder.userByPhone(user.phoneNumber).PK,
            GSI1SK: `USER#${user.userId}`,
            createdAt: userDdb.createdAt,
            updatedAt: userDdb.updatedAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    if (hasUsername) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: IdentityKeyBuilder.userByUsername(user.username).PK,
            SK: IdentityKeyBuilder.userByUsername(user.username).SK,
            entityType: ENTITY_TYPES.USERNAME_LOOKUP,
            userId: user.userId,
            username: IdentityKeyBuilder.normalizeUsername(user.username),
            GSI1PK: IdentityKeyBuilder.userByUsername(user.username).PK,
            GSI1SK: `USER#${user.userId}`,
            createdAt: userDdb.createdAt,
            updatedAt: userDdb.updatedAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    if (user.identityId?.trim()) {
      const identityKeys = IdentityKeyBuilder.userByIdentityId(user.identityId);
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: identityKeys.PK,
            SK: identityKeys.SK,
            entityType: ENTITY_TYPES.IDENTITY_LOOKUP,
            userId: user.userId,
            identityId: user.identityId.trim(),
            GSI1PK: identityKeys.PK,
            GSI1SK: `USER#${user.userId}`,
            createdAt: userDdb.createdAt,
            updatedAt: userDdb.updatedAt,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    if (profile) {
      const profileDdb = IdentityMapper.toProfileDdb(profile);
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: profileDdb,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    try {
      await this.transactWrite({ TransactItems: transactItems });
      log.info({ event: 'repository_success' });
      return user;
    } catch (err: any) {
      log.warn({ event: 'repository_failure', error: err.message });
      throw new UserAlreadyExistsException(
        `User registration failed due to conflicting email, phone, or username.`,
      );
    }
  }

  async getUser(userId: string): Promise<User | null> {
    const keys = IdentityKeyBuilder.userMeta(userId);
    const item = await this.get<UserDdbItem>(TABLE_NAME, keys);
    return item ? IdentityMapper.toUserDomain(item) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const normalized = IdentityKeyBuilder.normalizeEmail(email);
    const items = await this.query<any>({
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI1,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `${PREFIXES.EMAIL}${normalized}`,
      },
    });

    if (items.length === 0) return null;
    const userId = items[0].userId;
    return this.getUser(userId);
  }

  async getUserByPhone(phone: string): Promise<User | null> {
    const normalized = IdentityKeyBuilder.normalizePhone(phone);
    const items = await this.query<any>({
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI1,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `${PREFIXES.PHONE}${normalized}`,
      },
    });

    if (items.length === 0) return null;
    const userId = items[0].userId;
    return this.getUser(userId);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const normalized = IdentityKeyBuilder.normalizeUsername(username);
    const items = await this.query<any>({
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI1,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `${PREFIXES.USERNAME}${normalized}`,
      },
    });

    if (items.length === 0) return null;
    const userId = items[0].userId;
    return this.getUser(userId);
  }

  async getUserByIdentityId(identityId: string): Promise<User | null> {
    const keys = IdentityKeyBuilder.userByIdentityId(identityId);
    const item = await this.get<{ userId?: string }>(TABLE_NAME, keys);
    if (!item?.userId) return null;
    return this.getUser(item.userId);
  }

  async linkIdentity(
    userId: string,
    identityId: string,
    cognitoUsername: string,
  ): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new UserAlreadyExistsException(`User ${userId} not found.`);
    }

    if (user.identityId && user.identityId !== identityId) {
      throw new UserAlreadyExistsException(
        'User is already linked to a different identity',
      );
    }

    const existing = await this.getUserByIdentityId(identityId);
    if (existing && existing.userId !== userId) {
      throw new UserAlreadyExistsException(
        'Cognito identity is already linked to another user',
      );
    }

    const lookupPresent = Boolean(existing && existing.userId === userId);
    const userAlreadyLinked =
      user.identityId === identityId && Boolean(user.cognitoUsername);

    if (lookupPresent && userAlreadyLinked) {
      return user;
    }

    const timestamp = new Date().toISOString();
    const identityKeys = IdentityKeyBuilder.userByIdentityId(identityId);
    const userKeys = IdentityKeyBuilder.userMeta(userId);
    const transactItems: any[] = [];

    if (!lookupPresent) {
      transactItems.push({
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: identityKeys.PK,
            SK: identityKeys.SK,
            entityType: ENTITY_TYPES.IDENTITY_LOOKUP,
            userId,
            identityId,
            GSI1PK: identityKeys.PK,
            GSI1SK: `USER#${userId}`,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    if (!userAlreadyLinked) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: userKeys,
          UpdateExpression:
            'SET identityId = :identityId, cognitoUsername = :cognitoUsername, version = :nextVersion, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':identityId': identityId,
            ':cognitoUsername': cognitoUsername,
            ':nextVersion': user.version + 1,
            ':expectedVersion': user.version,
            ':updatedAt': timestamp,
          },
          ConditionExpression: 'version = :expectedVersion',
        },
      });
    }

    if (transactItems.length === 0) {
      return {
        ...user,
        identityId,
        cognitoUsername,
      };
    }

    await this.transactWrite({
      TransactItems: transactItems,
    }).catch((err) => {
      throw new UserAlreadyExistsException(
        err instanceof Error ? err.message : 'Failed to link identity',
      );
    });

    return {
      ...user,
      identityId,
      cognitoUsername,
      version: userAlreadyLinked ? user.version : user.version + 1,
      updatedAt: timestamp,
    };
  }

  async updateUser(user: User, expectedVersion: number): Promise<User> {
    const log = createChildLogger(this.repoLogger, {
      operation: 'updateUser',
      userId: user.userId,
    });
    log.info({ event: 'repository_start' });

    const keys = IdentityKeyBuilder.userMeta(user.userId);
    const timestamp = new Date().toISOString();

    const updateParams: UpdateCommandInput = {
      TableName: TABLE_NAME,
      Key: keys,
      UpdateExpression:
        'SET email = :email, username = :username, phoneNumber = :phone, roleId = :role, #status = :status, emailVerified = :emailVer, phoneVerified = :phoneVer, version = :nextVersion, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':email': IdentityKeyBuilder.normalizeEmail(user.email),
        ':username': IdentityKeyBuilder.normalizeUsername(user.username),
        ':phone': IdentityKeyBuilder.normalizePhone(user.phoneNumber),
        ':role': user.roleId || '',
        ':status': user.status,
        ':emailVer': user.emailVerified,
        ':phoneVer': user.phoneVerified,
        ':nextVersion': expectedVersion + 1,
        ':expectedVersion': expectedVersion,
        ':updatedAt': timestamp,
      },
      ConditionExpression: 'version = :expectedVersion',
    };

    try {
      await this.update(updateParams);
      log.info({ event: 'repository_success' });
      return { ...user, version: expectedVersion + 1, updatedAt: timestamp };
    } catch (err: any) {
      log.warn({ event: 'repository_failure', error: err.message });
      throw new ConditionalWriteConflictError(err);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const log = createChildLogger(this.repoLogger, {
      operation: 'deleteUser',
      userId,
    });
    log.info({ event: 'repository_start' });

    const user = await this.getUser(userId);
    if (!user) return;

    const sessions = await this.listSessions(userId);

    const transactItems: any[] = [
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userMeta(userId),
        },
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userByEmail(user.email),
        },
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userByPhone(user.phoneNumber),
        },
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userByUsername(user.username),
        },
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userProfile(userId),
        },
      },
    ];

    if (user.identityId) {
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userByIdentityId(user.identityId),
        },
      });
    }

    for (const session of sessions) {
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userSession(userId, session.sessionId),
        },
      });
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.refreshTokenLookup(session.refreshTokenHash),
        },
      });
    }

    try {
      await this.transactWrite({ TransactItems: transactItems });
      log.info({ event: 'repository_success' });
    } catch (err: any) {
      log.warn({ event: 'repository_failure', error: err.message });
      throw err;
    }
  }

  async listUsersByTenant(
    tenantId: string,
    limit?: number,
    nextToken?: string,
  ): Promise<{ items: User[]; nextToken?: string }> {
    const startKey = nextToken
      ? JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'))
      : undefined;

    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI2,
      KeyConditionExpression:
        'GSI2PK = :gsi2pk AND begins_with(GSI2SK, :gsi2sk)',
      ExpressionAttributeValues: {
        ':gsi2pk': IdentityKeyBuilder.gsi2Pk(tenantId),
        ':gsi2sk': `${PREFIXES.USER}`,
      },
      Limit: limit,
      ExclusiveStartKey: startKey,
    };

    const result = await this.queryPage<UserDdbItem>(params);
    const domainItems = result.items.map((item) =>
      IdentityMapper.toUserDomain(item),
    );
    const token = result.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64')
      : undefined;

    return {
      items: domainItems,
      nextToken: token,
    };
  }

  // --- AUTHENTICATION METHODS ---

  async createSession(session: Session): Promise<Session> {
    const log = createChildLogger(this.repoLogger, {
      operation: 'createSession',
      userId: session.userId,
      sessionId: session.sessionId,
    });
    log.info({ event: 'repository_start' });

    const sessionDdb = IdentityMapper.toSessionDdb(session);

    const refreshLookup: RefreshTokenLookupDdbItem = {
      PK: IdentityKeyBuilder.refreshTokenLookup(session.refreshTokenHash).PK,
      SK: IdentityKeyBuilder.refreshTokenLookup(session.refreshTokenHash).SK,
      entityType: ENTITY_TYPES.REFRESH_TOKEN_LOOKUP,
      tokenHash: session.refreshTokenHash,
      userId: session.userId,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      ttl: session.ttl,
      GSI5PK: `REFRESH#${session.refreshTokenHash}`,
      GSI5SK: `USER#${session.userId}#SESSION#${session.sessionId}`,
      createdAt: sessionDdb.createdAt,
      updatedAt: sessionDdb.updatedAt,
    };

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: sessionDdb,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: refreshLookup,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      });
      log.info({ event: 'repository_success' });
      return session;
    } catch (err: any) {
      log.warn({ event: 'repository_failure', error: err.message });
      throw err;
    }
  }

  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    const keys = IdentityKeyBuilder.userSession(userId, sessionId);
    const item = await this.get<SessionDdbItem>(TABLE_NAME, keys);
    return item ? IdentityMapper.toSessionDomain(item) : null;
  }

  async listSessions(userId: string): Promise<Session[]> {
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `${PREFIXES.USER}${userId}`,
        ':skPrefix': `${PREFIXES.SESSION}`,
      },
    };
    const items = await this.query<SessionDdbItem>(params);
    return items.map((item) => IdentityMapper.toSessionDomain(item));
  }

  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const log = createChildLogger(this.repoLogger, {
      operation: 'deleteSession',
      userId,
      sessionId,
    });
    log.info({ event: 'repository_start' });

    const session = await this.getSession(userId, sessionId);
    if (!session) return;

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Delete: {
              TableName: TABLE_NAME,
              Key: IdentityKeyBuilder.userSession(userId, sessionId),
            },
          },
          {
            Delete: {
              TableName: TABLE_NAME,
              Key: IdentityKeyBuilder.refreshTokenLookup(
                session.refreshTokenHash,
              ),
            },
          },
        ],
      });
      log.info({ event: 'repository_success' });
    } catch (err: any) {
      log.warn({ event: 'repository_failure', error: err.message });
      throw err;
    }
  }

  async deleteAllSessions(userId: string): Promise<void> {
    const log = createChildLogger(this.repoLogger, {
      operation: 'deleteAllSessions',
      userId,
    });
    log.info({ event: 'repository_start' });

    const sessions = await this.listSessions(userId);
    if (sessions.length === 0) return;

    const transactItems: any[] = [];
    for (const session of sessions) {
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.userSession(userId, session.sessionId),
        },
      });
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: IdentityKeyBuilder.refreshTokenLookup(session.refreshTokenHash),
        },
      });
    }

    try {
      await this.transactWrite({ TransactItems: transactItems });
      log.info({ event: 'repository_success' });
    } catch (err: any) {
      log.warn({ event: 'repository_failure', error: err.message });
      throw err;
    }
  }

  async createRefreshToken(
    userId: string,
    tokenId: string,
    tokenHash: string,
    expiresAt: string,
    ttl?: number,
  ): Promise<void> {
    const keys = IdentityKeyBuilder.refreshToken(userId, tokenId);
    const timestamp = new Date().toISOString();
    const item = {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.REFRESH_TOKEN_LOOKUP,
      userId,
      tokenHash,
      expiresAt,
      ttl,
      GSI5PK: `REFRESH#${tokenHash}`,
      GSI5SK: `USER#${userId}#REFRESH#${tokenId}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.put(TABLE_NAME, item, 'attribute_not_exists(PK)');
  }

  async getRefreshToken(tokenHash: string): Promise<Session | null> {
    const keys = IdentityKeyBuilder.refreshTokenLookup(tokenHash);
    const lookup = await this.get<RefreshTokenLookupDdbItem>(TABLE_NAME, keys);
    if (lookup) {
      return this.getSession(lookup.userId, lookup.sessionId);
    }

    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI5,
      KeyConditionExpression: 'GSI5PK = :gsi5pk',
      ExpressionAttributeValues: {
        ':gsi5pk': `REFRESH#${tokenHash}`,
      },
    };
    try {
      const items = await this.query<any>(params);
      if (items.length === 0) return null;

      const record = items[0];
      if (record.entityType === ENTITY_TYPES.SESSION) {
        return IdentityMapper.toSessionDomain(record as SessionDdbItem);
      }
      if (record.entityType === ENTITY_TYPES.REFRESH_TOKEN_LOOKUP) {
        return this.getSession(record.userId, record.sessionId);
      }
      return null;
    } catch {
      return null;
    }
  }

  async deleteRefreshToken(tokenHash: string): Promise<void> {
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI5,
      KeyConditionExpression: 'GSI5PK = :gsi5pk',
      ExpressionAttributeValues: {
        ':gsi5pk': `REFRESH#${tokenHash}`,
      },
    };
    const items = await this.query<any>(params);
    if (items.length === 0) return;

    const transactItems: any[] = [];
    for (const record of items) {
      transactItems.push({
        Delete: {
          TableName: TABLE_NAME,
          Key: {
            PK: record.PK,
            SK: record.SK,
          },
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });
  }

  async changePassword(
    userId: string,
    newPasswordHash: string,
    expectedVersion: number,
  ): Promise<void> {
    const log = createChildLogger(this.repoLogger, {
      operation: 'changePassword',
      userId,
    });
    log.info({ event: 'repository_start' });

    const user = await this.getUser(userId);
    if (!user)
      throw new UserAlreadyExistsException(`User ${userId} not found.`);

    const timestamp = new Date().toISOString();
    const userKeys = IdentityKeyBuilder.userMeta(userId);
    const passHistoryKeys = IdentityKeyBuilder.passwordHistory(
      userId,
      timestamp,
    );

    const transactItems: any[] = [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: userKeys,
          UpdateExpression:
            'SET passwordHash = :passwordHash, version = :nextVersion, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':passwordHash': newPasswordHash,
            ':nextVersion': expectedVersion + 1,
            ':expectedVersion': expectedVersion,
            ':updatedAt': timestamp,
          },
          ConditionExpression: 'version = :expectedVersion',
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: passHistoryKeys.PK,
            SK: passHistoryKeys.SK,
            entityType: ENTITY_TYPES.PASSWORD_HISTORY,
            userId,
            passwordHash: user.passwordHash,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
    ];

    try {
      await this.transactWrite({ TransactItems: transactItems });
      log.info({ event: 'repository_success' });
    } catch (err: any) {
      log.warn({ event: 'repository_failure', error: err.message });
      throw new ConditionalWriteConflictError(err);
    }
  }

  async storePasswordHistory(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const keys = IdentityKeyBuilder.passwordHistory(userId, timestamp);
    const item = {
      PK: keys.PK,
      SK: keys.SK,
      entityType: ENTITY_TYPES.PASSWORD_HISTORY,
      userId,
      passwordHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.put(TABLE_NAME, item);
  }

  // --- OTP METHODS ---

  async createOtp(otp: Otp): Promise<Otp> {
    const otpDdb = IdentityMapper.toOtpDdb(otp);
    await this.put(TABLE_NAME, otpDdb);
    return otp;
  }

  async verifyOtp(
    destination: string,
    purpose: string,
    codeHash: string,
  ): Promise<boolean> {
     const log = createChildLogger(this.repoLogger, {
       operation: 'verifyOtp',
       purpose,
     });
    const latest = await this.getLatestOtp(destination, purpose);

    if (!latest) {
      return false;
    }

    const now = new Date().toISOString();
    const maxAttempts = 5;

    if (latest.expiresAt <= now || latest.verified) {
      return false;
    }

    if (latest.attempts >= maxAttempts) {
      return false;
    }

    const hashMatched = latest.codeHash === codeHash;

    log.info({
      event: 'otp_verification_validation',
      hashMatched,
      challengeExpired: latest.expiresAt <= now,
      challengeConsumed: latest.verified,
      attemptLimitReached: latest.attempts >= maxAttempts,
      maxAttempts,
    });

    const keys = IdentityKeyBuilder.otp(destination, purpose);

    if (!hashMatched) {
      try {
        await this.update({
          TableName: TABLE_NAME,
          Key: keys,
          UpdateExpression:
            'SET attempts = attempts + :one, updatedAt = :updatedAt',
          ConditionExpression:
            'attempts < :maxAttempts AND expiresAt > :now AND verified = :unverified',
          ExpressionAttributeValues: {
            ':one': 1,
            ':maxAttempts': maxAttempts,
            ':now': now,
            ':unverified': false,
            ':updatedAt': now,
          },
        });
      } catch (error) {
        log.warn({
          event: 'otp_attempt_update_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }

      return false;
    }

    try {
      await this.update({
        TableName: TABLE_NAME,
        Key: keys,
        UpdateExpression: 'SET verified = :verified, updatedAt = :updatedAt',
        ConditionExpression: [
          'verified = :unverified',
          'expiresAt > :now',
          'codeHash = :codeHash',
          'attempts < :maxAttempts',
        ].join(' AND '),
        ExpressionAttributeValues: {
          ':verified': true,
          ':unverified': false,
          ':now': now,
          ':updatedAt': now,
          ':codeHash': codeHash,
          ':maxAttempts': maxAttempts,
        },
      });

      return true;
    } catch (error) {
      log.error({
        event: 'otp_verification_update_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });

      return false;
    }
  }

  async deleteOtp(destination: string, purpose: string): Promise<void> {
    const keys = IdentityKeyBuilder.otp(destination, purpose);
    await this.delete(TABLE_NAME, keys);
  }

  async getLatestOtp(
    destination: string,
    purpose: string,
  ): Promise<Otp | null> {
    const keys = IdentityKeyBuilder.otp(destination, purpose);
    const item = await this.get<OtpDdbItem>(TABLE_NAME, keys);
    return item ? IdentityMapper.toOtpDomain(item) : null;
  }

  // --- ROLES METHODS ---

  async assignRole(userId: string, roleId: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user)
      throw new UserAlreadyExistsException(`User ${userId} not found.`);

    const timestamp = new Date().toISOString();
    const userKeys = IdentityKeyBuilder.userMeta(userId);
    const userRoleKeys = IdentityKeyBuilder.userRole(userId, roleId);

    const transactItems: any[] = [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: userKeys,
          UpdateExpression:
            'SET roleId = :roleId, version = :nextVersion, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':roleId': roleId,
            ':nextVersion': user.version + 1,
            ':expectedVersion': user.version,
            ':updatedAt': timestamp,
          },
          ConditionExpression: 'version = :expectedVersion',
        },
      },
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: userRoleKeys.PK,
            SK: userRoleKeys.SK,
            entityType: ENTITY_TYPES.USER_ROLE,
            userId,
            roleId,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      },
    ];

    await this.transactWrite({ TransactItems: transactItems });
  }

  async removeRole(userId: string, roleId: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user)
      throw new UserAlreadyExistsException(`User ${userId} not found.`);

    const timestamp = new Date().toISOString();
    const userKeys = IdentityKeyBuilder.userMeta(userId);
    const userRoleKeys = IdentityKeyBuilder.userRole(userId, roleId);

    const transactItems: any[] = [
      {
        Update: {
          TableName: TABLE_NAME,
          Key: userKeys,
          UpdateExpression:
            'SET roleId = :emptyRole, version = :nextVersion, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':emptyRole': '',
            ':nextVersion': user.version + 1,
            ':expectedVersion': user.version,
            ':updatedAt': timestamp,
          },
          ConditionExpression: 'version = :expectedVersion',
        },
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: userRoleKeys,
        },
      },
    ];

    await this.transactWrite({ TransactItems: transactItems });
  }

  /**
   * Deletes USER#{userId} / ROLE#{roleId} without removing other mappings.
   * When the profile `roleId` is that same application role, it is reset to
   * `user` so the next token does not restore the revoked role.
   */
  async deleteUserRoleMapping(
    userId: string,
    roleId: string,
  ): Promise<'deleted' | 'missing'> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new UserAlreadyExistsException(`User ${userId} not found.`);
    }

    const timestamp = new Date().toISOString();
    const userRoleKeys = IdentityKeyBuilder.userRole(userId, roleId);
    const transactItems: any[] = [
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: userRoleKeys,
        },
      },
    ];

    const [requested] = resolveApplicationRoles([roleId]);
    const profileMatches =
      requested !== undefined &&
      resolveApplicationRoles([user.roleId]).includes(requested);
    if (profileMatches) {
      const userKeys = IdentityKeyBuilder.userMeta(userId);
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: userKeys,
          UpdateExpression:
            'SET roleId = :roleId, version = :nextVersion, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':roleId': 'user',
            ':nextVersion': user.version + 1,
            ':expectedVersion': user.version,
            ':updatedAt': timestamp,
          },
          ConditionExpression: 'version = :expectedVersion',
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });
    return 'deleted';
  }

  /**
   * Writes USER#{userId} / ROLE#{roleId} when that mapping is absent.
   * Does not change the profile `roleId` and does not remove other role mappings.
   */
  async ensureUserRoleMapping(
    userId: string,
    roleId: string,
  ): Promise<'created' | 'exists'> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new UserAlreadyExistsException(`User ${userId} not found.`);
    }

    const timestamp = new Date().toISOString();
    const keys = IdentityKeyBuilder.userRole(userId, roleId);
    try {
      await this.put(
        TABLE_NAME,
        {
          PK: keys.PK,
          SK: keys.SK,
          entityType: ENTITY_TYPES.USER_ROLE,
          userId,
          roleId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        'attribute_not_exists(PK)',
      );
      return 'created';
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        return 'exists';
      }
      throw err;
    }
  }

  async listUserMetaPage(exclusiveStartKey?: Record<string, unknown>): Promise<{
    users: User[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const result = await sendDoc<ScanCommandOutput>(
      ddbDocClient,
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(PK, :userPrefix) AND SK = :meta',
        ExpressionAttributeValues: {
          ':userPrefix': PREFIXES.USER,
          ':meta': SK_VALS.META,
        },
        ExclusiveStartKey:
          exclusiveStartKey as ScanCommandInput['ExclusiveStartKey'],
      }),
    );

    const users = (result.Items ?? [])
      .filter((item) => typeof item.userId === 'string' && item.userId.trim())
      .map((item) => IdentityMapper.toUserDomain(item as UserDdbItem));

    return {
      users,
      lastEvaluatedKey: result.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined,
    };
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `${PREFIXES.USER}${userId}`,
        ':skPrefix': `${PREFIXES.ROLE}`,
      },
    };
    const items = await this.query<any>(params);
    return items.map((item) => item.roleId);
  }

  async getRole(roleId: string): Promise<Role | null> {
    const keys = IdentityKeyBuilder.role(roleId);
    const item = await this.get<RoleDdbItem>(TABLE_NAME, keys);
    return item ? IdentityMapper.toRoleDomain(item) : null;
  }

  async listRoles(): Promise<Role[]> {
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI1,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': 'ROLE_CATALOG',
      },
    };
    const items = await this.query<RoleDdbItem>(params);
    return items.map((item) => IdentityMapper.toRoleDomain(item));
  }

  // --- PERMISSIONS METHODS ---

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `${PREFIXES.ROLE}${roleId}`,
        ':skPrefix': `${PREFIXES.PERMISSION}`,
      },
    };
    const items = await this.query<PermissionDdbItem>(params);
    return items.map((item) => IdentityMapper.toPermissionDomain(item));
  }

  async hasPermission(roleId: string, permissionId: string): Promise<boolean> {
    const keys = IdentityKeyBuilder.permission(roleId, permissionId);
    const item = await this.get<PermissionDdbItem>(TABLE_NAME, keys);
    return item !== null;
  }

  async listPermissions(roleId: string): Promise<Permission[]> {
    return this.getRolePermissions(roleId);
  }

  // --- AUDIT METHODS ---

  async saveLoginHistory(history: LoginHistory): Promise<void> {
    const item = IdentityMapper.toLoginHistoryDdb(history);
    await this.put(TABLE_NAME, item);
  }

  async listLoginHistory(userId: string): Promise<LoginHistory[]> {
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `${PREFIXES.USER}${userId}`,
        ':skPrefix': `${PREFIXES.LOGIN_HISTORY}`,
      },
    };
    const items = await this.query<LoginHistoryDdbItem>(params);
    return items.map((item) => IdentityMapper.toLoginHistoryDomain(item));
  }

  async saveAudit(auditLog: AuditLog): Promise<void> {
    const item = IdentityMapper.toAuditDdb(auditLog);
    item.GSI1PK = `${PREFIXES.USER}${auditLog.userId}`;
    item.GSI1SK = `AUDIT#${auditLog.timestamp}`;
    await this.put(TABLE_NAME, item);
  }

  async listAudit(userId: string): Promise<AuditLog[]> {
    const params: QueryCommandInput = {
      TableName: TABLE_NAME,
      IndexName: GSI_INDEX_NAMES.GSI1,
      KeyConditionExpression:
        'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1sk)',
      ExpressionAttributeValues: {
        ':gsi1pk': `${PREFIXES.USER}${userId}`,
        ':gsi1sk': 'AUDIT#',
      },
    };
    const items = await this.query<AuditLogDdbItem>(params);
    return items.map((item) => IdentityMapper.toAuditDomain(item));
  }
}

export const identityRepositoryInstance = new IdentityRepository();
