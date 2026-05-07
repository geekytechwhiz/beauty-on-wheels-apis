/** Millisecond instants for persistence (Dynamo attributes + string SK segments after `TS#`). */

export function parseIsoToEpochMs(iso: string): number {
  const t = Date.parse(iso.trim());
  if (Number.isNaN(t)) {
    throw new Error(`Invalid ISO-8601 timestamp: ${iso}`);
  }
  return t;
}

export function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Fixed-width decimal string so lexical order matches chronological order in string sort keys. */
export function padEpochMs13(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid epoch milliseconds: ${ms}`);
  }
  const n = Math.floor(ms);
  return String(n).padStart(13, '0');
}

export function slaDateBucketUtcFromMs(ms: number): string {
  return epochMsToIso(ms).slice(0, 10);
}

/** Coerce persisted alert `triggerTimestamp` (ms number) or legacy ISO string to epoch ms. */
export function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  const p = Date.parse(String(value ?? ''));
  if (!Number.isNaN(p)) return p;
  return Date.now();
}

export function compareEpochOrIsoDesc(a: unknown, b: unknown): number {
  const ta = typeof a === 'number' && Number.isFinite(a) ? a : Date.parse(String(a ?? ''));
  const tb = typeof b === 'number' && Number.isFinite(b) ? b : Date.parse(String(b ?? ''));
  const na = Number.isNaN(ta) ? 0 : ta;
  const nb = Number.isNaN(tb) ? 0 : tb;
  if (na !== nb) return nb - na;
  return 0;
}
