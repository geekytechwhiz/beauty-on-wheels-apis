import {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { BootstrapError } from './types';

/**
 * First-admin bootstrap must leave the Identity PROFILE in `LINKED` state.
 * OTP registration writes `userProvisioning.status=PENDING` and relies on the
 * async Identity.Registered → User Service → User.Provisioned path. That path
 * can lag or fail; without LINKED the platform authorizer returns IAM Deny
 * (HTTP 403 "explicit deny in an identity-based policy") on every protected
 * business route except Identity self routes.
 *
 * Application user id matches User Service provisioning: Identity `userId`
 * (never Cognito `sub`).
 */

export type ApplicationUserLinkInput = {
  identityTable: string;
  userId: string;
  identityId: string;
  now: string;
  phone?: string;
  email?: string;
  /** When set, also ensures the User Service profile + identity lookup exist. */
  userTable?: string;
};

export type ApplicationUserLinkResult = {
  identityLink: 'linked' | 'already-linked';
  userService?: 'created' | 'already-exists' | 'skipped';
};

export async function loadIdentityIdForUser(
  db: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): Promise<string | null> {
  const meta = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: 'META' },
      ConsistentRead: true,
    }),
  );
  const identityId = meta.Item?.identityId;
  return typeof identityId === 'string' && identityId.trim()
    ? identityId.trim()
    : null;
}

export async function loadProfileProvisioning(
  db: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): Promise<{ status?: string; userId?: string; requestedAt?: string } | null> {
  const profile = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
      ConsistentRead: true,
    }),
  );
  const provisioning = profile.Item?.userProvisioning as
    | { status?: string; userId?: string; requestedAt?: string }
    | undefined;
  return provisioning ?? null;
}

/**
 * Idempotently sets PROFILE.userProvisioning to LINKED with the Identity userId
 * as the application subject (same contract as IdentityRepository.linkProvisionedUser).
 */
export async function linkIdentityApplicationUser(
  db: DynamoDBDocumentClient,
  input: {
    tableName: string;
    userId: string;
    applicationUserId: string;
    now: string;
  },
): Promise<'linked' | 'already-linked'> {
  const current = await loadProfileProvisioning(
    db,
    input.tableName,
    input.userId,
  );
  if (
    current?.status === 'LINKED' &&
    current.userId === input.applicationUserId
  ) {
    return 'already-linked';
  }
  if (
    current?.status === 'LINKED' &&
    current.userId &&
    current.userId !== input.applicationUserId
  ) {
    throw new BootstrapError(
      `Identity ${input.userId} is already linked to a different application user`,
      'APPLICATION_USER_LINK_CONFLICT',
    );
  }

  try {
    await db.send(
      new UpdateCommand({
        TableName: input.tableName,
        Key: { PK: `USER#${input.userId}`, SK: 'PROFILE' },
        UpdateExpression:
          'SET userProvisioning = :provisioning, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':provisioning': {
            status: 'LINKED',
            userId: input.applicationUserId,
            requestedAt: current?.requestedAt ?? input.now,
            linkedAt: input.now,
          },
          ':updatedAt': input.now,
          ':pending': 'PENDING',
          ':linked': 'LINKED',
          ':userId': input.applicationUserId,
        },
        ConditionExpression:
          'attribute_exists(PK) AND (attribute_not_exists(userProvisioning.#status) OR userProvisioning.#status = :pending OR (userProvisioning.#status = :linked AND userProvisioning.#userId = :userId))',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#userId': 'userId',
        },
      }),
    );
    return 'linked';
  } catch (error) {
    const refreshed = await loadProfileProvisioning(
      db,
      input.tableName,
      input.userId,
    );
    if (
      refreshed?.status === 'LINKED' &&
      refreshed.userId === input.applicationUserId
    ) {
      return 'already-linked';
    }
    throw new BootstrapError(
      'Failed to mark Identity userProvisioning as LINKED',
      'APPLICATION_USER_LINK_FAILED',
      {
        recoverable: true,
        recoveryHint:
          'Inspect USER#<userId>/PROFILE.userProvisioning. Fix the condition conflict, then re-run with --repair-application-link.',
        cause: error,
      },
    );
  }
}

/**
 * Creates the minimal User Service profile + identity lookup when missing.
 * Mirrors IdentityProvisioningService.ensureUserForIdentity / createProvisionedUser.
 */
export async function ensureUserServiceApplicationUser(
  db: DynamoDBDocumentClient,
  input: {
    userTable: string;
    userId: string;
    identityId: string;
    now: string;
    phone?: string;
    email?: string;
  },
): Promise<'created' | 'already-exists'> {
  const existing = await db.send(
    new GetCommand({
      TableName: input.userTable,
      Key: {
        PK: `IDENTITY#${input.identityId}`,
        SK: 'LOOKUP',
      },
      ConsistentRead: true,
    }),
  );
  if (existing.Item?.userId) {
    return 'already-exists';
  }

  const profile: Record<string, unknown> = {
    PK: `USER#${input.userId}`,
    SK: 'PROFILE',
    entityType: 'CustomerProfile',
    userId: input.userId,
    status: 'active',
    communityIds: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (input.email?.trim()) {
    profile.email = input.email.trim().toLowerCase();
  }
  if (input.phone?.trim()) {
    profile.phone = input.phone.trim();
  }

  const lookup = {
    PK: `IDENTITY#${input.identityId}`,
    SK: 'LOOKUP',
    entityType: 'IdentityUserLookup',
    identityId: input.identityId,
    userId: input.userId,
    createdAt: input.now,
  };

  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: input.userTable,
              Item: profile,
              ConditionExpression:
                'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: input.userTable,
              Item: lookup,
              ConditionExpression:
                'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
        ],
      }),
    );
    return 'created';
  } catch (error) {
    const raced = await db.send(
      new GetCommand({
        TableName: input.userTable,
        Key: {
          PK: `IDENTITY#${input.identityId}`,
          SK: 'LOOKUP',
        },
        ConsistentRead: true,
      }),
    );
    if (raced.Item?.userId === input.userId) {
      return 'already-exists';
    }
    throw new BootstrapError(
      'Failed to create User Service application user for first admin',
      'USER_SERVICE_PROVISION_FAILED',
      {
        recoverable: true,
        recoveryHint:
          'Confirm --user-table is reachable and the operator role can TransactWriteItems. Then re-run with --repair-application-link.',
        cause: error,
      },
    );
  }
}

export async function ensureApplicationUserLinked(
  db: DynamoDBDocumentClient,
  input: ApplicationUserLinkInput,
): Promise<ApplicationUserLinkResult> {
  if (!input.identityId.trim()) {
    throw new BootstrapError(
      'META.identityId is required to link the application user',
      'IDENTITY_ID_MISSING',
      {
        recoverable: true,
        recoveryHint:
          'Inspect USER#<userId>/META.identityId. OTP verify should have written Cognito sub before ADMIN commit.',
      },
    );
  }

  const identityLink = await linkIdentityApplicationUser(db, {
    tableName: input.identityTable,
    userId: input.userId,
    applicationUserId: input.userId,
    now: input.now,
  });

  if (!input.userTable?.trim()) {
    return { identityLink, userService: 'skipped' };
  }

  const userService = await ensureUserServiceApplicationUser(db, {
    userTable: input.userTable.trim(),
    userId: input.userId,
    identityId: input.identityId,
    now: input.now,
    phone: input.phone,
    email: input.email,
  });

  return { identityLink, userService };
}

export async function verifyApplicationUserLinked(
  db: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): Promise<void> {
  const provisioning = await loadProfileProvisioning(db, tableName, userId);
  if (
    provisioning?.status !== 'LINKED' ||
    provisioning.userId !== userId
  ) {
    throw new BootstrapError(
      'Application user link was not verified on Identity PROFILE',
      'APPLICATION_USER_LINK_UNVERIFIED',
      {
        recoverable: true,
        recoveryHint:
          'Re-run with --repair-application-link after confirming PROFILE exists.',
      },
    );
  }
}
