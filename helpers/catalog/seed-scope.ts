/**
 * Smoke test: seed a small subset for local testing.
 * Set `METADATA_SEED_SMOKE_TEST` to `false` to seed the full Excel catalog.
 */
export const METADATA_SEED_SMOKE_TEST = true;

export const METADATA_SEED_SMOKE_TYPES = ['ApplicableModule'] as const;

export function isSmokeTestEnabled(): boolean {
  return METADATA_SEED_SMOKE_TEST;
}

export function filterTypesForScope<T extends { metadataTypeCode: string }>(items: T[]): T[] {
  if (!METADATA_SEED_SMOKE_TEST) {
    return items;
  }
  const allowed = new Set<string>(METADATA_SEED_SMOKE_TYPES);
  return items.filter((item) => allowed.has(item.metadataTypeCode));
}

export function filterOrderForScope(order: string[]): string[] {
  if (!METADATA_SEED_SMOKE_TEST) {
    return order;
  }
  const allowed = new Set<string>(METADATA_SEED_SMOKE_TYPES);
  return order.filter((code) => allowed.has(code));
}

export function filterValueCatalogForScope(
  catalog: Record<string, unknown[]>,
): Record<string, unknown[]> {
  if (!METADATA_SEED_SMOKE_TEST) {
    return catalog;
  }
  const allowed = new Set<string>(METADATA_SEED_SMOKE_TYPES);
  const out: Record<string, unknown[]> = {};
  for (const [type, seeds] of Object.entries(catalog)) {
    if (allowed.has(type)) {
      out[type] = seeds;
    }
  }
  return out;
}
