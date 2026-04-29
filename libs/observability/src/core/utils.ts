/** @internal */
export const safeStringify = (value: unknown): string => {
  const visited = new WeakSet<object>();
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === 'object' && current !== null) {
      if (visited.has(current)) {
        return '[Circular]';
      }
      visited.add(current);
    }
    return current;
  });
};

/** @internal Deep clone via JSON — for error cause chains only. */
export const safeParse = (value: unknown): unknown => {
  const serialized = safeStringify(value);
  return JSON.parse(serialized) as unknown;
};
