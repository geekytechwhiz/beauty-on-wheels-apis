import { normalizeTemplateActor } from '@api-hub/template-core';

import {
  enrichTemplateActorUserFromMap,
  getUserProfilesByIds,
} from '../services/user-lookup.service';

function addActorUserId(ids: Set<string>, value: unknown): void {
  const actor = normalizeTemplateActor(value);
  if (actor?.userId?.trim()) {
    ids.add(actor.userId.trim());
  }
}

function collectFromHistory(ids: Set<string>, history: unknown): void {
  if (!Array.isArray(history)) return;
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const h = entry as Record<string, unknown>;
    addActorUserId(ids, h.updatedBy);
    addActorUserId(ids, h.publishedBy);
  }
}

/** Collect user ids only from known audit fields — never from arbitrary strings in the payload. */
function collectActorUserIds(payload: unknown): string[] {
  const ids = new Set<string>();
  if (!payload || typeof payload !== 'object') return [];

  const root = payload as Record<string, unknown>;

  addActorUserId(ids, root.updatedBy);

  const meta = root.meta;
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    addActorUserId(ids, m.createdBy);
    addActorUserId(ids, m.lastModifiedBy);
    addActorUserId(ids, m.publishedBy);
  }

  collectFromHistory(ids, root.versionHistory);

  if (Array.isArray(root.items)) {
    for (const item of root.items) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      addActorUserId(ids, row.updatedBy);
      collectFromHistory(ids, row.history);
      collectFromHistory(ids, row.versionHistory);
    }
  }

  return [...ids];
}

async function enrichActorValue(
  value: unknown,
  profiles: Map<string, { email?: string; displayName?: string }>,
): Promise<unknown> {
  const actor = normalizeTemplateActor(value);
  if (!actor) return value;
  return (await enrichTemplateActorUserFromMap(actor, profiles)) ?? value;
}

/** Enrich createdBy / lastModifiedBy / publishedBy / history actors from USER_TABLE on API responses. */
export async function enrichRecordActorsForApi<T>(payload: T): Promise<T> {
  const ids = collectActorUserIds(payload);
  if (ids.length === 0) return payload;

  let profiles: Map<string, { email?: string; displayName?: string }>;
  try {
    profiles = await getUserProfilesByIds(ids);
  } catch {
    return payload;
  }

  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  const meta = clone.meta;
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    if (m.createdBy) m.createdBy = await enrichActorValue(m.createdBy, profiles);
    if (m.lastModifiedBy) m.lastModifiedBy = await enrichActorValue(m.lastModifiedBy, profiles);
    if (m.publishedBy) m.publishedBy = await enrichActorValue(m.publishedBy, profiles);
  }

  if (Array.isArray(clone.versionHistory)) {
    clone.versionHistory = await Promise.all(
      clone.versionHistory.map(async (entry: unknown) => {
        if (!entry || typeof entry !== 'object') return entry;
        const h = { ...(entry as Record<string, unknown>) };
        if (h.updatedBy) h.updatedBy = await enrichActorValue(h.updatedBy, profiles);
        if (h.publishedBy) h.publishedBy = await enrichActorValue(h.publishedBy, profiles);
        return h;
      }),
    );
  }

  if (Array.isArray(clone.items)) {
    clone.items = await Promise.all(
      clone.items.map(async (item: unknown) => enrichListItemActors(item, profiles)),
    );
  }

  if (clone.updatedBy) {
    clone.updatedBy = await enrichActorValue(clone.updatedBy, profiles);
  }

  return clone as T;
}

async function enrichListItemActors(
  item: unknown,
  profiles: Map<string, { email?: string; displayName?: string }>,
): Promise<unknown> {
  if (!item || typeof item !== 'object') return item;
  const row = { ...(item as Record<string, unknown>) };
  if (row.updatedBy) row.updatedBy = await enrichActorValue(row.updatedBy, profiles);
  if (Array.isArray(row.history)) {
    row.history = await Promise.all(
      row.history.map(async (entry: unknown) => {
        if (!entry || typeof entry !== 'object') return entry;
        const h = { ...(entry as Record<string, unknown>) };
        if (h.updatedBy) h.updatedBy = await enrichActorValue(h.updatedBy, profiles);
        if (h.publishedBy) h.publishedBy = await enrichActorValue(h.publishedBy, profiles);
        return h;
      }),
    );
  }
  return row;
}
