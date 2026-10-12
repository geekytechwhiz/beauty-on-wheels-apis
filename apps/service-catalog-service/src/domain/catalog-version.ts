/** First server-assigned catalog version. Callers cannot choose it. */
export const INITIAL_CATALOG_VERSION = 1;

export function isAuthoritativeCatalogVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Missing versions initialize to 1. A real price or eligibility change
 * increments from that baseline. The result is never a client-supplied number.
 */
export function nextCatalogVersion(existing: number | undefined, changed: boolean): number {
  const current = isAuthoritativeCatalogVersion(existing) ? existing : INITIAL_CATALOG_VERSION;
  return changed ? current + 1 : current;
}

export function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const value of left) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const value of right) {
    const count = counts.get(value);
    if (!count) {
      return false;
    }
    counts.set(value, count - 1);
  }
  return true;
}

export function isConditionalWriteFailure(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';
  return name === 'ConditionalCheckFailedException' || name === 'ConditionalWriteConflictError';
}
