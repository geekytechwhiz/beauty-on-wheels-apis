export const deepClone = <T>(obj: T): T => structuredClone(obj);

export const isEmpty = (value: unknown): boolean => {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    if (typeof value === "string") return value.trim().length === 0;
    return false;
  };

export const escapeRegExp = (s: string) => s?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
