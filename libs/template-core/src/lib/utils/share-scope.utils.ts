import { SHARE_SCOPE, type ShareScope } from '../constants/template.constants';

const STRICT_SHARE_SCOPE_ALIASES: Record<string, ShareScope> = {
  PRIVATE: SHARE_SCOPE.PRIVATE,
  ORGANIZATION: SHARE_SCOPE.ORGANIZATION,
  PUBLIC: SHARE_SCOPE.PUBLIC,
};

/** Legacy values when reading stored templates (not accepted on API write). */
const LEGACY_SHARE_SCOPE_ALIASES: Record<string, ShareScope> = {
  ORG: SHARE_SCOPE.ORGANIZATION,
  PLATFORM: SHARE_SCOPE.PUBLIC,
  SHAREABLE: SHARE_SCOPE.PUBLIC,
};

function shareScopeKey(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return raw.trim().replace(/\s+/g, '_').toUpperCase();
}

export function normalizeShareScope(raw: unknown): ShareScope | undefined {
  const key = shareScopeKey(raw);
  if (!key) return undefined;
  return STRICT_SHARE_SCOPE_ALIASES[key] ?? LEGACY_SHARE_SCOPE_ALIASES[key];
}

export function normalizeShareScopeOrThrow(raw: unknown, fieldName = 'shareScope'): ShareScope {
  const key = shareScopeKey(raw);
  const normalized = key ? STRICT_SHARE_SCOPE_ALIASES[key] : undefined;
  if (!normalized) {
    const err = new Error(
      `Invalid ${fieldName}. Allowed values: Private, Organization, Public (case-insensitive)`,
    ) as Error & { statusCode: number; code: string };
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return normalized;
}
