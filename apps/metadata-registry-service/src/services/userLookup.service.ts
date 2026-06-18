import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  BatchGetCommand,
  type BatchGetCommandInput,
  type BatchGetCommandOutput,
  QueryCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';

const USER_PK_PREFIX = 'USER#';
const ORG_SK_ROOT = 'ORG#ROOT';
const ORG_SK_PREFIX = 'ORG#';

const BATCH_GET_MAX_KEYS = 100;
/** Bounded parallelism for Query fallback when ORG#ROOT row is absent. */
const QUERY_FALLBACK_CHUNK = 25;

export const UNKNOWN_USER_LABEL = 'Unknown User';

/** setup.sh bootstrap root admin — display fallback when USER_TABLE lookup misses on a stage. */
const ROOT_ADMIN_USER_ID =
  '88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f';
const ROOT_ADMIN_DISPLAY_NAME = 'Root Admin';

export type UserDisplayEntry = { name: string };

function resolveActorDisplayName(userId: string, userMap: Map<string, UserDisplayEntry>): string {
  const fromLookup = userMap.get(userId)?.name;
  if (fromLookup && fromLookup !== UNKNOWN_USER_LABEL) {
    return fromLookup;
  }
  if (userId === ROOT_ADMIN_USER_ID) {
    return ROOT_ADMIN_DISPLAY_NAME;
  }
  return UNKNOWN_USER_LABEL;
}

/** Same workaround as libs/utils `sendDoc` — avoids @smithy/types duplicate in the workspace. */
async function docSend<T>(client: DynamoDBDocumentClient, command: unknown): Promise<T> {
  return (await (client as { send: (cmd: unknown) => Promise<unknown> }).send(command)) as T;
}

/** Exported for tests — derives API display name from a raw USER_TABLE row. */
export function resolveUserDisplayName(item: Record<string, unknown>): string {
  const fullName = item.fullName;
  if (typeof fullName === 'string' && fullName.trim() !== '') {
    return fullName.trim();
  }
  const first =
    typeof item.firstName === 'string' && item.firstName.trim() !== '' ? item.firstName.trim() : '';
  const last =
    typeof item.lastName === 'string' && item.lastName.trim() !== '' ? item.lastName.trim() : '';
  const combined = [first, last].filter(Boolean).join(' ').trim();
  if (combined !== '') {
    return combined;
  }
  const email = item.emailAddress;
  if (typeof email === 'string' && email.trim() !== '') {
    return email.trim();
  }
  const legacyEmail = item.email;
  if (typeof legacyEmail === 'string' && legacyEmail.trim() !== '') {
    return legacyEmail.trim();
  }
  return UNKNOWN_USER_LABEL;
}

function userIdFromPk(pk: unknown): string | null {
  if (typeof pk !== 'string' || !pk.startsWith(USER_PK_PREFIX)) {
    return null;
  }
  return pk.slice(USER_PK_PREFIX.length);
}

function userIdFromSk(sk: unknown): string | null {
  if (typeof sk !== 'string' || !sk.startsWith(USER_PK_PREFIX)) {
    return null;
  }
  return sk.slice(USER_PK_PREFIX.length);
}

function userIdFromUserOrgRow(row: Record<string, unknown>): string | null {
  const fromPk = userIdFromPk(row.pk);
  if (fromPk) {
    return fromPk;
  }
  const fromSk = userIdFromSk(row.sk);
  if (fromSk) {
    return fromSk;
  }
  const userID = row.userID;
  if (typeof userID === 'string' && userID.trim() !== '') {
    return userID.trim();
  }
  return null;
}

function mergeRowIntoMap(map: Map<string, UserDisplayEntry>, row: Record<string, unknown>): void {
  const id = userIdFromUserOrgRow(row);
  if (!id || map.has(id)) {
    return;
  }
  const name = resolveUserDisplayName(row);
  if (name === UNKNOWN_USER_LABEL) {
    return;
  }
  map.set(id, { name });
}

async function batchGetOrgRootRows(tableName: string, userIds: string[]): Promise<Map<string, UserDisplayEntry>> {
  const map = new Map<string, UserDisplayEntry>();
  const client = ddbDocClient;

  for (let i = 0; i < userIds.length; i += BATCH_GET_MAX_KEYS) {
    const slice = userIds.slice(i, i + BATCH_GET_MAX_KEYS);
    let requestItems: NonNullable<BatchGetCommandInput['RequestItems']> = {
      [tableName]: {
        Keys: slice.map((userId) => ({
          pk: `${USER_PK_PREFIX}${userId}`,
          sk: ORG_SK_ROOT,
        })),
      },
    };

    // Retry UnprocessedKeys (at most a few rounds).
    for (let attempt = 0; attempt < 4; attempt++) {
      const out = await docSend<BatchGetCommandOutput>(client, new BatchGetCommand({ RequestItems: requestItems }));
      const rows = out.Responses?.[tableName];
      if (rows) {
        for (const raw of rows) {
          mergeRowIntoMap(map, raw as Record<string, unknown>);
        }
      }

      const unprocessed = out.UnprocessedKeys;
      if (unprocessed == null || Object.keys(unprocessed).length === 0) {
        break;
      }
      requestItems = unprocessed as typeof requestItems;
    }
  }

  return map;
}

/** Root admin / org-user index rows from setup.sh: pk = ORG#ROOT, sk = USER#&lt;userId&gt;. */
async function batchGetOrgScopedUserRows(
  tableName: string,
  userIds: string[],
  orgPk: string,
): Promise<Map<string, UserDisplayEntry>> {
  const map = new Map<string, UserDisplayEntry>();
  const client = ddbDocClient;

  for (let i = 0; i < userIds.length; i += BATCH_GET_MAX_KEYS) {
    const slice = userIds.slice(i, i + BATCH_GET_MAX_KEYS);
    let requestItems: NonNullable<BatchGetCommandInput['RequestItems']> = {
      [tableName]: {
        Keys: slice.map((userId) => ({
          pk: orgPk,
          sk: `${USER_PK_PREFIX}${userId}`,
        })),
      },
    };

    for (let attempt = 0; attempt < 4; attempt++) {
      const out = await docSend<BatchGetCommandOutput>(client, new BatchGetCommand({ RequestItems: requestItems }));
      const rows = out.Responses?.[tableName];
      if (rows) {
        for (const raw of rows) {
          mergeRowIntoMap(map, raw as Record<string, unknown>);
        }
      }

      const unprocessed = out.UnprocessedKeys;
      if (unprocessed == null || Object.keys(unprocessed).length === 0) {
        break;
      }
      requestItems = unprocessed as typeof requestItems;
    }
  }

  return map;
}

async function queryFirstOrgRow(tableName: string, userId: string): Promise<Record<string, unknown> | null> {
  const out = await docSend<QueryCommandOutput>(
    ddbDocClient,
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(#sk, :skp)',
      ExpressionAttributeNames: { '#sk': 'sk' },
      ExpressionAttributeValues: {
        ':pk': `${USER_PK_PREFIX}${userId}`,
        ':skp': ORG_SK_PREFIX,
      },
      Limit: 1,
    }),
  );
  const row = out.Items?.[0];
  return row != null ? (row as Record<string, unknown>) : null;
}

async function fetchMissingViaQueryFallback(
  tableName: string,
  missingIds: string[],
  map: Map<string, UserDisplayEntry>,
): Promise<void> {
  for (let i = 0; i < missingIds.length; i += QUERY_FALLBACK_CHUNK) {
    const chunk = missingIds.slice(i, i + QUERY_FALLBACK_CHUNK);
    const rows = await Promise.all(chunk.map((id) => queryFirstOrgRow(tableName, id)));
    for (let j = 0; j < chunk.length; j++) {
      const id = chunk[j];
      const row = rows[j];
      if (row != null && !map.has(id)) {
        mergeRowIntoMap(map, row);
      }
    }
  }
}

/**
 * Batch-load display names from USER_TABLE.
 * 1. USER# / ORG#ROOT (user-service org membership rows)
 * 2. Query USER# / begins_with ORG# for unresolved ids
 * 3. ORG#ROOT / USER# (setup.sh root-admin and org-user index rows)
 */
export async function getUsersByIds(userIds: ReadonlyArray<string | undefined>): Promise<Map<string, UserDisplayEntry>> {
  const unique = [...new Set(userIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
  const tableName = process.env.USER_TABLE?.trim();
  const map = new Map<string, UserDisplayEntry>();

  if (unique.length === 0 || !tableName) {
    return map;
  }

  const fromBatch = await batchGetOrgRootRows(tableName, unique);
  for (const [k, v] of fromBatch) {
    map.set(k, v);
  }

  let stillMissing = unique.filter((id) => !map.has(id));
  if (stillMissing.length > 0) {
    await fetchMissingViaQueryFallback(tableName, stillMissing, map);
  }

  stillMissing = unique.filter((id) => !map.has(id));
  if (stillMissing.length > 0) {
    const fromOrgScoped = await batchGetOrgScopedUserRows(tableName, stillMissing, ORG_SK_ROOT);
    for (const [k, v] of fromOrgScoped) {
      map.set(k, v);
    }
  }

  return map;
}

export function collectUserIdsForEnrichment(
  records:
    | { createdBy?: string; lastModifiedBy?: string }
    | ReadonlyArray<{ createdBy?: string; lastModifiedBy?: string }>,
): string[] {
  const list = Array.isArray(records) ? records : [records];
  const ids = new Set<string>();
  for (const r of list) {
    const c = r.createdBy?.trim();
    const m = r.lastModifiedBy?.trim();
    if (c) ids.add(c);
    if (m) ids.add(m);
  }
  return [...ids];
}

export type AuditActorApiModel = { userId: string; name: string };

export function enrichMetadataRecordActors<
  T extends { createdBy?: string; lastModifiedBy?: string },
>(
  record: T,
  userMap: Map<string, UserDisplayEntry>,
): Omit<T, 'createdBy' | 'lastModifiedBy'> & {
  createdBy?: AuditActorApiModel;
  lastModifiedBy?: AuditActorApiModel;
} {
  const next = { ...record } as Omit<T, 'createdBy' | 'lastModifiedBy'> & {
    createdBy?: AuditActorApiModel;
    lastModifiedBy?: AuditActorApiModel;
  };

  if (record.createdBy != null && String(record.createdBy).trim() !== '') {
    const userId = String(record.createdBy).trim();
    next.createdBy = {
      userId,
      name: resolveActorDisplayName(userId, userMap),
    };
  }

  if (record.lastModifiedBy != null && String(record.lastModifiedBy).trim() !== '') {
    const userId = String(record.lastModifiedBy).trim();
    next.lastModifiedBy = {
      userId,
      name: resolveActorDisplayName(userId, userMap),
    };
  }

  return next;
}
