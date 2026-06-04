type PaginationWithToken = {
  limit?: number;
  count?: number;
  total?: number;
  hasMore?: boolean;
  nextToken?: string;
};

/**
 * Maps internal list pagination to the API shape used across platform list endpoints:
 * - `pagination` holds page metadata (limit, count, total, hasMore)
 * - `nextPaginationKey` is the opaque cursor for the next page (pass as query param)
 */
export function withNextPaginationKey<T extends Record<string, unknown>>(
  result: T & { pagination?: PaginationWithToken; nextToken?: string },
): Omit<T, 'nextToken'> & {
  pagination?: Omit<PaginationWithToken, 'nextToken'>;
  nextPaginationKey: string | null;
} {
  const cursor =
    result.pagination?.nextToken ?? (typeof result.nextToken === 'string' ? result.nextToken : undefined);

  const out: Record<string, unknown> = { ...result };
  delete out.nextToken;

  if (result.pagination) {
    const { nextToken: _t, ...pageMeta } = result.pagination;
    out.pagination = pageMeta;
  }

  out.nextPaginationKey = cursor ?? null;

  return out as Omit<T, 'nextToken'> & {
    pagination?: Omit<PaginationWithToken, 'nextToken'>;
    nextPaginationKey: string | null;
  };
}
