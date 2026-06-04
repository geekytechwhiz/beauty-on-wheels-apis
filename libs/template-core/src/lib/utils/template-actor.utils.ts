import type { TemplateActorUser } from '../models/template-actor.model';
import { firstString } from './template.utils';

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOpaqueIdentifier(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (UUID_LIKE.test(v)) return true;
  if (/^[0-9a-f]{32,}$/i.test(v)) return true;
  return false;
}

function pickDisplayName(
  displayName: string | undefined,
  email: string | undefined,
): string | undefined {
  if (displayName && !isOpaqueIdentifier(displayName)) return displayName;
  return email;
}

/** Normalize legacy string ids or stored user objects into a consistent actor shape. */
export function normalizeTemplateActor(value: unknown): TemplateActorUser | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === 'string') {
    const userId = value.trim();
    return userId ? { userId } : undefined;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const userId =
      firstString(o.userId) ??
      firstString(o.id) ??
      firstString(o.userID);
    if (!userId) return undefined;
    const email = firstString(o.email);
    const rawDisplay =
      firstString(o.displayName) ?? firstString(o.name) ?? firstString(o.fullName);
    const displayName = pickDisplayName(rawDisplay, email);
    const role = firstString(o.role);
    return {
      userId,
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {}),
      ...(role ? { role } : {}),
    };
  }

  return undefined;
}

export function resolveTemplateActor(
  actor?: TemplateActorUser,
  legacyUserId?: string,
): TemplateActorUser | undefined {
  if (actor?.userId?.trim()) {
    const displayName = pickDisplayName(actor.displayName, actor.email);
    return {
      userId: actor.userId.trim(),
      ...(actor.email ? { email: actor.email } : {}),
      ...(displayName ? { displayName } : {}),
      ...(actor.role ? { role: actor.role } : {}),
    };
  }
  return normalizeTemplateActor(legacyUserId);
}

/** Extract user id for indexes / logs when meta may store object or legacy string. */
export function templateActorUserId(value: unknown): string | undefined {
  return normalizeTemplateActor(value)?.userId;
}
