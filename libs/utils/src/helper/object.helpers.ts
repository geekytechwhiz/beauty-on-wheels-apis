export const deepClone = <T>(obj: T): T => structuredClone(obj);

export const isEmpty = (value: unknown): boolean => {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    if (typeof value === "string") return value.trim().length === 0;
    return false;
  };

export const escapeRegExp = (s: string) => s?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Deterministic JSON-like string for hashing: sorted object keys at every level.
 * Throws for unsupported types (e.g. function, symbol).
 */
export function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return JSON.stringify(value);
  }
  if (t === 'bigint') {
    const asBig = value as bigint;
    return JSON.stringify(asBig.toString());
  }
  if (t === 'undefined') {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  throw new TypeError(`stableStringify: unsupported type ${t}`);
}

