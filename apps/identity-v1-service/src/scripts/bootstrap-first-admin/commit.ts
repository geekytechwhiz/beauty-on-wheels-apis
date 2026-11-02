import {
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { IdentityKeyBuilder } from '../../keys/identity-key.builder';
import {
  BOOTSTRAP_KEYS,
  type CommitPlan,
  BootstrapError,
} from './types';

/**
 * Storage contract mirrors IdentityRepository.ensureUserRoleMapping:
 * USER#{userId} / ROLE#ADMIN with entityType UserRole. Does not touch META.roleId.
 * Authority: scripts/bootstrap-first-admin.mjs + repository put shape.
 */
export function buildAdminRoleMappingItem(input: {
  userId: string;
  now: string;
}) {
  return {
    PK: `USER#${input.userId}`,
    SK: 'ROLE#ADMIN',
    entityType: 'UserRole',
    userId: input.userId,
    roleId: 'ADMIN',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function buildBootstrapMarkerItem(input: CommitPlan) {
  return {
    ...BOOTSTRAP_KEYS.marker,
    entityType: 'AdminBootstrap',
    targetUserId: input.userId,
    stage: input.stage,
    approvedBy: input.approvedBy,
    executedBy: input.executedBy,
    changeTicket: input.changeTicket,
    runId: input.runId,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function buildAuditItem(input: CommitPlan) {
  const auditDetails = JSON.stringify({
    stage: input.stage,
    approvedBy: input.approvedBy,
    executedBy: input.executedBy,
    changeTicket: input.changeTicket,
    method: 'first-admin-bootstrap',
    runId: input.runId,
  });
  return {
    PK: `AUDIT#${input.auditId}`,
    SK: 'METADATA',
    entityType: 'AuditLog',
    auditId: input.auditId,
    userId: input.userId,
    action: 'first_admin_bootstrapped',
    details: auditDetails,
    timestamp: input.now,
    createdAt: input.now,
    updatedAt: input.now,
    GSI1PK: `USER#${input.userId}`,
    GSI1SK: `AUDIT#${input.now}`,
  };
}

export function buildCommitTransactItems(plan: CommitPlan) {
  return [
    {
      Put: {
        TableName: plan.tableName,
        Item: buildAdminRoleMappingItem({
          userId: plan.userId,
          now: plan.now,
        }),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    {
      Put: {
        TableName: plan.tableName,
        Item: buildBootstrapMarkerItem(plan),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    {
      Put: {
        TableName: plan.tableName,
        Item: buildAuditItem(plan),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  ];
}

export async function loadUserMeta(
  db: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: 'META' },
      ConsistentRead: true,
    }),
  );
  return (result.Item as Record<string, unknown> | undefined) ?? null;
}

export async function loadRoleMetadata(
  db: DynamoDBDocumentClient,
  tableName: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: 'ROLE#ADMIN', SK: 'METADATA' },
      ConsistentRead: true,
    }),
  );
  return (result.Item as Record<string, unknown> | undefined) ?? null;
}

export async function loadBootstrapMarker(
  db: DynamoDBDocumentClient,
  tableName: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: BOOTSTRAP_KEYS.marker,
      ConsistentRead: true,
    }),
  );
  return (result.Item as Record<string, unknown> | undefined) ?? null;
}

export async function countAdminRoleMappings(
  db: DynamoDBDocumentClient,
  tableName: string,
): Promise<number> {
  let adminMappingCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const page = await db.send(
      new ScanCommand({
        TableName: tableName,
        ConsistentRead: true,
        FilterExpression: '#entityType = :userRole AND #roleId = :admin',
        ExpressionAttributeNames: {
          '#entityType': 'entityType',
          '#roleId': 'roleId',
        },
        ExpressionAttributeValues: {
          ':userRole': 'UserRole',
          ':admin': 'ADMIN',
        },
        Select: 'COUNT',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    adminMappingCount += page.Count ?? 0;
    lastEvaluatedKey = page.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  return adminMappingCount;
}

export async function listUserRoleIds(
  db: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): Promise<string[]> {
  const existingRoles = await db.send(
    new QueryCommand({
      TableName: tableName,
      ConsistentRead: true,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':prefix': 'ROLE#',
      },
    }),
  );
  return (existingRoles.Items ?? [])
    .map((item) => item.roleId)
    .filter((roleId): roleId is string => typeof roleId === 'string');
}

export async function findUserIdByDestination(
  db: DynamoDBDocumentClient,
  tableName: string,
  destination: string,
  destinationKind: 'email' | 'phone',
): Promise<string | null> {
  // Match IdentityKeyBuilder lookup keys used by OtpService / IdentityRepository.
  const key =
    destinationKind === 'email'
      ? IdentityKeyBuilder.userByEmail(destination)
      : IdentityKeyBuilder.userByPhone(destination);

  const lookup = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: key,
      ConsistentRead: true,
    }),
  );
  const userId = lookup.Item?.userId;
  return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
}

export function assertReadyForAdminCommit(input: {
  user: Record<string, unknown> | null;
  role: Record<string, unknown> | null;
  bootstrapMarker: Record<string, unknown> | null;
  adminMappingCount: number;
  existingRoles: string[];
}): void {
  if (!input.user) {
    throw new BootstrapError(
      'Identity userId was not found',
      'IDENTITY_NOT_FOUND',
    );
  }
  if (String(input.user.status ?? '').toLowerCase() !== 'active') {
    throw new BootstrapError(
      'Target identity is not active',
      'IDENTITY_INACTIVE',
    );
  }
  if (!input.role || input.role.roleId !== 'ADMIN') {
    throw new BootstrapError(
      'ADMIN role metadata is missing; stop and repair role setup first',
      'ADMIN_ROLE_METADATA_MISSING',
    );
  }
  if (input.bootstrapMarker) {
    throw new BootstrapError(
      'The first-admin bootstrap marker already exists',
      'BOOTSTRAP_ALREADY_COMPLETED',
    );
  }
  if (input.adminMappingCount > 0) {
    throw new BootstrapError(
      'An ADMIN role mapping already exists; use the normal admin role API',
      'ADMIN_ALREADY_EXISTS',
    );
  }
  if (input.existingRoles.includes('ADMIN')) {
    throw new BootstrapError(
      'Target already has an ADMIN mapping',
      'TARGET_ALREADY_ADMIN',
    );
  }
}

export async function commitFirstAdminMapping(
  db: DynamoDBDocumentClient,
  plan: CommitPlan,
): Promise<void> {
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: buildCommitTransactItems(plan),
      }),
    );
  } catch (error) {
    throw new BootstrapError(
      'DynamoDB transaction failed while writing ADMIN mapping',
      'DYNAMODB_TRANSACTION_FAILED',
      {
        recoverable: true,
        recoveryHint:
          'Inspect the journal and SYSTEM#FIRST_ADMIN_BOOTSTRAP marker. If none were written, resume with --resume-run-id after fixing permissions or conflicts.',
        cause: error,
      },
    );
  }
}

export async function verifyAdminMapping(
  db: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): Promise<void> {
  const verify = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: 'ROLE#ADMIN' },
      ConsistentRead: true,
    }),
  );
  if (verify.Item?.roleId !== 'ADMIN') {
    throw new BootstrapError(
      'Transaction completed but ADMIN mapping could not be verified',
      'ADMIN_MAPPING_UNVERIFIED',
      {
        recoverable: true,
        recoveryHint:
          'Do not re-run blindly. Inspect USER# / ROLE#ADMIN and the bootstrap marker, then follow manual recovery in docs/first-admin-bootstrap.md.',
      },
    );
  }
}
