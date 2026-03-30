/**
 * Deep-merge plain objects; arrays and scalars are replaced by the overlay when defined.
 */
export function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const b = base[key];
    const o = overlay[key];
    if (
      o !== null &&
      typeof o === 'object' &&
      !Array.isArray(o) &&
      b !== null &&
      typeof b === 'object' &&
      !Array.isArray(b)
    ) {
      out[key] = deepMerge(b as Record<string, unknown>, o as Record<string, unknown>);
    } else {
      out[key] = o;
    }
  }
  return out;
}
