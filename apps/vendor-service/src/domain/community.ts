export const MAX_VENDOR_COMMUNITIES = 25;

const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function normalizeCommunityId(value: string): string {
  return value.trim();
}

export function isCommunityId(value: string): boolean {
  return COMMUNITY_ID_PATTERN.test(value);
}

export function uniqueCommunityIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = normalizeCommunityId(value);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}
