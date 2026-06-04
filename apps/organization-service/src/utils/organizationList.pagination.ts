const ORG_LIST_CURSOR_KEY_ATTRIBUTES = ['pk', 'sk', 'gsi1pk', 'gsi1sk'] as const;

export function buildOrgListCursorKey(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const key: Record<string, unknown> = {};
  for (const attr of ORG_LIST_CURSOR_KEY_ATTRIBUTES) {
    const value = item[attr];
    if (value !== undefined && value !== null && value !== '') {
      key[attr] = value;
    }
  }
  return Object.keys(key).length > 0 ? key : undefined;
}

export function encodeOrgListPaginationKey(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | null {
  if (!lastEvaluatedKey || Object.keys(lastEvaluatedKey).length === 0) {
    return null;
  }
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}

export function decodeOrgListPaginationKey(token: string): Record<string, unknown> {
  const trimmed = token.trim();
  return JSON.parse(Buffer.from(trimmed, 'base64').toString()) as Record<string, unknown>;
}

/** Accepts nextPaginationKey (base64) or lastEvaluatedKey (base64 string or Dynamo key object). */
export function resolveOrgListPaginationKey(input: {
  nextPaginationKey?: string;
  lastEvaluatedKey?: string | Record<string, unknown> | null;
}): string | undefined {
  const fromNext = input.nextPaginationKey?.trim();
  if (fromNext) {
    return fromNext;
  }

  const fromLast = input.lastEvaluatedKey;
  if (typeof fromLast === 'string' && fromLast.trim().length > 0) {
    return fromLast.trim();
  }

  if (fromLast && typeof fromLast === 'object' && !Array.isArray(fromLast)) {
    const encoded = encodeOrgListPaginationKey(fromLast);
    return encoded ?? undefined;
  }

  return undefined;
}
