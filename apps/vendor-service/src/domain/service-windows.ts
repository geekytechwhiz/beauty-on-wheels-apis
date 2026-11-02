/**
 * Authoritative service-window configuration for vendor operating preferences.
 *
 * Catalog package `visitWindowId` values and availability window ids in this
 * platform use this set. Persist these ids, never display labels such as "Morning".
 * There is no separate service-window list endpoint; this configuration is the
 * allow-list until the catalog publishes one.
 */
export const SERVICE_WINDOW_IDS = [
  'morning',
  'anytime',
  'weekday_morning',
  'weekend_day',
  'night',
] as const;

export type ServiceWindowId = (typeof SERVICE_WINDOW_IDS)[number];

const SERVICE_WINDOW_ID_SET = new Set<string>(SERVICE_WINDOW_IDS);

export function isKnownServiceWindowId(value: string): value is ServiceWindowId {
  return SERVICE_WINDOW_ID_SET.has(value);
}
