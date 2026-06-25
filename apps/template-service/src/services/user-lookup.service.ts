import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  type BatchGetCommandInput,
  type BatchGetCommandOutput,
  type GetCommandOutput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { TemplateActorUser } from '@api-hub/template-core';
import { ddbDocClient } from '@api-hub/utils';
import { getTemplateAppEnv } from '../config/env';

const USER_PK_PREFIX = 'USER#';
const ORG_SK_ROOT = 'ORG#ROOT';
const ORG_SK_PREFIX = 'ORG#';
const BATCH_GET_MAX_KEYS = 100;

type UserTableKey = Record<string, string>;

async function docSend<T>(command: unknown): Promise<T> {
  return (await (ddbDocClient as { send: (cmd: unknown) => Promise<unknown> }).send(command)) as T;
}

function isValidationException(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const message = (err as { message?: string })?.message ?? '';
  return name === 'ValidationException' || message.includes('ValidationException');
}

function userRootKey(userId: string, uppercaseKeys: boolean): UserTableKey {
  return uppercaseKeys
    ? { PK: `${USER_PK_PREFIX}${userId}`, SK: ORG_SK_ROOT }
    : { pk: `${USER_PK_PREFIX}${userId}`, sk: ORG_SK_ROOT };
}

export function resolveUserDisplayName(item: Record<string, unknown>): string | undefined {
  const fullName = item.fullName;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();

  const first =
    typeof item.firstName === 'string' && item.firstName.trim() ? item.firstName.trim() : '';
  const last =
    typeof item.lastName === 'string' && item.lastName.trim() ? item.lastName.trim() : '';
  const combined = [first, last].filter(Boolean).join(' ').trim();
  if (combined) return combined;

  const email = item.emailAddress;
  if (typeof email === 'string' && email.trim()) return email.trim();

  return undefined;
}

export function resolveUserEmail(item: Record<string, unknown>): string | undefined {
  const email = item.emailAddress;
  if (typeof email === 'string' && email.trim()) return email.trim();
  return undefined;
}

function userIdFromRow(row: Record<string, unknown>): string | null {
  const pk = (row.pk ?? row.PK) as unknown;
  if (typeof pk !== 'string' || !pk.startsWith(USER_PK_PREFIX)) return null;
  return pk.slice(USER_PK_PREFIX.length);
}

async function getOrgRootRow(
  tableName: string,
  userId: string,
  uppercaseKeys: boolean,
): Promise<Record<string, unknown> | null> {
  const out = await docSend<GetCommandOutput>(
    new GetCommand({
      TableName: tableName,
      Key: userRootKey(userId, uppercaseKeys),
    }),
  );
  return out.Item != null ? (out.Item as Record<string, unknown>) : null;
}

async function queryFirstOrgRow(
  tableName: string,
  userId: string,
  uppercaseKeys: boolean,
): Promise<Record<string, unknown> | null> {
  const pkAttr = uppercaseKeys ? 'PK' : 'pk';
  const skAttr = uppercaseKeys ? 'SK' : 'sk';
  const out = await docSend<QueryCommandOutput>(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: `${pkAttr} = :pk AND begins_with(#sk, :skp)`,
      ExpressionAttributeNames: { '#sk': skAttr },
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

async function loadUserProfileRow(
  tableName: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const root = await getOrgRootRow(tableName, userId, false);
    if (root) return root;
    return await queryFirstOrgRow(tableName, userId, false);
  } catch (err) {
    if (!isValidationException(err)) return null;
    try {
      const root = await getOrgRootRow(tableName, userId, true);
      if (root) return root;
      return await queryFirstOrgRow(tableName, userId, true);
    } catch {
      return null;
    }
  }
}

/** Load one user profile row from USER_TABLE (ORG#ROOT, then ORG#* fallback). */
export async function getUserProfileById(userId: string): Promise<Record<string, unknown> | null> {
  const id = userId?.trim();
  const tableName = getTemplateAppEnv().USER_TABLE?.trim();
  if (!id || !tableName) return null;
  return loadUserProfileRow(tableName, id);
}

/**
 * Merge JWT actor with USER_TABLE profile (fullName / email).
 * Falls back to token values when the table row is missing or lookup fails.
 */
export async function enrichTemplateActorUser(actor: TemplateActorUser): Promise<TemplateActorUser> {
  try {
    const row = await getUserProfileById(actor.userId);
    if (!row) return actor;

    const email = resolveUserEmail(row) ?? actor.email;
    const displayName = resolveUserDisplayName(row) ?? actor.displayName ?? email;

    return {
      userId: actor.userId,
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {}),
      ...(actor.role ? { role: actor.role } : {}),
    };
  } catch {
    return actor;
  }
}

async function batchGetOrgRootRows(
  tableName: string,
  userIds: string[],
  uppercaseKeys: boolean,
): Promise<Map<string, { email?: string; displayName?: string }>> {
  const map = new Map<string, { email?: string; displayName?: string }>();

  for (let i = 0; i < userIds.length; i += BATCH_GET_MAX_KEYS) {
    const slice = userIds.slice(i, i + BATCH_GET_MAX_KEYS);
    let requestItems: NonNullable<BatchGetCommandInput['RequestItems']> = {
      [tableName]: {
        Keys: slice.map((userId) => userRootKey(userId, uppercaseKeys)),
      },
    };

    for (let attempt = 0; attempt < 4; attempt++) {
      const out = await docSend<BatchGetCommandOutput>(
        new BatchGetCommand({ RequestItems: requestItems }),
      );
      for (const raw of out.Responses?.[tableName] ?? []) {
        const row = raw as Record<string, unknown>;
        const id = userIdFromRow(row);
        if (!id || map.has(id)) continue;
        map.set(id, {
          email: resolveUserEmail(row),
          displayName: resolveUserDisplayName(row),
        });
      }

      const unprocessed = out.UnprocessedKeys;
      if (!unprocessed || Object.keys(unprocessed).length === 0) break;
      requestItems = unprocessed as typeof requestItems;
    }
  }

  return map;
}

/** Batch load profiles for read-path enrichment (e.g. version history actors). */
export async function getUserProfilesByIds(
  userIds: ReadonlyArray<string | undefined>,
): Promise<Map<string, { email?: string; displayName?: string }>> {
  const unique = [...new Set(userIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
  const tableName = getTemplateAppEnv().USER_TABLE?.trim();
  const map = new Map<string, { email?: string; displayName?: string }>();

  if (unique.length === 0 || !tableName) return map;

  try {
    return await loadProfilesForIds(tableName, unique);
  } catch (err) {
    if (!isValidationException(err)) return map;
    try {
      return await loadProfilesForIds(tableName, unique, true);
    } catch {
      return map;
    }
  }
}

async function loadProfilesForIds(
  tableName: string,
  unique: string[],
  uppercaseKeys = false,
): Promise<Map<string, { email?: string; displayName?: string }>> {
  const map = new Map<string, { email?: string; displayName?: string }>();

  const fromBatch = await batchGetOrgRootRows(tableName, unique, uppercaseKeys);
  for (const [k, v] of fromBatch) map.set(k, v);

  const missing = unique.filter((id) => !map.has(id));
  for (const id of missing) {
    const row = await queryFirstOrgRow(tableName, id, uppercaseKeys);
    if (!row) continue;
    const resolvedId = userIdFromRow(row) ?? id;
    map.set(resolvedId, {
      email: resolveUserEmail(row),
      displayName: resolveUserDisplayName(row),
    });
  }
  return map;
}

export async function enrichTemplateActorUserFromMap(
  actor: TemplateActorUser | undefined,
  profiles: Map<string, { email?: string; displayName?: string }>,
): Promise<TemplateActorUser | undefined> {
  if (!actor?.userId?.trim()) return actor;
  const profile = profiles.get(actor.userId.trim());
  if (!profile) return actor;

  const email = profile.email ?? actor.email;
  const displayName = profile.displayName ?? actor.displayName ?? email;

  return {
    userId: actor.userId,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(actor.role ? { role: actor.role } : {}),
  };
}
