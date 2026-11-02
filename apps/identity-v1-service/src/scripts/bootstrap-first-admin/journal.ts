import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  BOOTSTRAP_KEYS,
  type BootstrapJournal,
  BootstrapError,
  type SagaState,
  SAGA_STATE,
} from './types';

export function journalKey(runId: string) {
  return {
    PK: BOOTSTRAP_KEYS.journalPk,
    SK: `RUN#${runId}`,
  };
}

export async function putJournal(
  db: DynamoDBDocumentClient,
  tableName: string,
  journal: BootstrapJournal,
): Promise<void> {
  const isCreate = journal.version === 1;
  await db.send(
    new PutCommand({
      TableName: tableName,
      Item: journal,
      ...(isCreate
        ? {
            ConditionExpression: 'attribute_not_exists(PK)',
          }
        : {
            ConditionExpression: 'version = :expectedVersion',
            ExpressionAttributeValues: {
              ':expectedVersion': journal.version - 1,
            },
          }),
    }),
  );
}

export async function getJournal(
  db: DynamoDBDocumentClient,
  tableName: string,
  runId: string,
): Promise<BootstrapJournal | null> {
  const result = await db.send(
    new GetCommand({
      TableName: tableName,
      Key: journalKey(runId),
      ConsistentRead: true,
    }),
  );
  return (result.Item as BootstrapJournal | undefined) ?? null;
}

export function advanceJournal(
  journal: BootstrapJournal,
  state: SagaState,
  patch: Partial<BootstrapJournal> = {},
  nowIso: string,
): BootstrapJournal {
  return {
    ...journal,
    ...patch,
    state,
    updatedAt: nowIso,
    version: journal.version + 1,
  };
}

export async function acquireBootstrapLock(
  db: DynamoDBDocumentClient,
  tableName: string,
  input: {
    runId: string;
    executedBy: string;
    nowIso: string;
    leaseSeconds?: number;
  },
): Promise<void> {
  const leaseSeconds = input.leaseSeconds ?? 30 * 60;
  const expiresAt = new Date(
    Date.parse(input.nowIso) + leaseSeconds * 1000,
  ).toISOString();
  try {
    await db.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...BOOTSTRAP_KEYS.lock,
          entityType: 'AdminBootstrapLock',
          runId: input.runId,
          executedBy: input.executedBy,
          createdAt: input.nowIso,
          updatedAt: input.nowIso,
          expiresAt,
          ttl: Math.floor(Date.parse(expiresAt) / 1000),
        },
        ConditionExpression:
          'attribute_not_exists(PK) OR expiresAt < :now OR runId = :runId',
        ExpressionAttributeValues: {
          ':now': input.nowIso,
          ':runId': input.runId,
        },
      }),
    );
  } catch (error) {
    throw new BootstrapError(
      'Another first-admin bootstrap holds the lock',
      'BOOTSTRAP_LOCK_HELD',
      {
        recoverable: true,
        recoveryHint:
          'Wait for the other operator run to finish or expire, inspect SYSTEM#FIRST_ADMIN_BOOTSTRAP_LOCK, then resume with --resume-run-id if this run owns the journal.',
        cause: error,
      },
    );
  }
}

export async function releaseBootstrapLock(
  db: DynamoDBDocumentClient,
  tableName: string,
  runId: string,
): Promise<void> {
  try {
    await db.send(
      new DeleteCommand({
        TableName: tableName,
        Key: BOOTSTRAP_KEYS.lock,
        ConditionExpression: 'runId = :runId',
        ExpressionAttributeValues: { ':runId': runId },
      }),
    );
  } catch {
    // Lock may already be gone or owned by another run; never steal it.
  }
}

export function createInitialJournal(input: {
  runId: string;
  stage: string;
  tableName: string;
  region: string;
  accountId: string;
  apiBaseUrl: string;
  destinationKind: BootstrapJournal['destinationKind'];
  destinationFingerprint: string;
  approvedBy: string;
  executedBy: string;
  changeTicket: string;
  mode: BootstrapJournal['mode'];
  nowIso: string;
}): BootstrapJournal {
  const key = journalKey(input.runId);
  return {
    runId: input.runId,
    entityType: 'AdminBootstrapJournal',
    PK: key.PK,
    SK: key.SK,
    state: SAGA_STATE.PREFLIGHT,
    stage: input.stage,
    tableName: input.tableName,
    region: input.region,
    accountId: input.accountId,
    apiBaseUrl: input.apiBaseUrl,
    destinationKind: input.destinationKind,
    destinationFingerprint: input.destinationFingerprint,
    approvedBy: input.approvedBy,
    executedBy: input.executedBy,
    changeTicket: input.changeTicket,
    mode: input.mode,
    ownership: {
      createdIdentityAccount: false,
      createdCognitoUser: false,
      cognitoExistedBeforeRun: 'unknown',
      identityExistedBeforeRun: false,
    },
    adminMappingWritten: false,
    bootstrapMarkerWritten: false,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    version: 1,
  };
}
