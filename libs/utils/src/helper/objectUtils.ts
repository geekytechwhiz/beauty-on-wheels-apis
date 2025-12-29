export const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

export const isEmpty = (obj: object): boolean => Object.keys(obj).length === 0;

export const escapeRegExp = (s: string) => s?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
