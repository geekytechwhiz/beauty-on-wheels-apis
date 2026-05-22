/**
 * Returns true when value is a non-null object and not an array.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasNonEmptyStringField(
  data: unknown,
  field: string,
): boolean {
  if (!isRecord(data)) {
    return false;
  }

  const value = data[field];
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasAnyNonEmptyStringField(
  data: unknown,
  fields: string[],
): boolean {
  return fields.some((field) => hasNonEmptyStringField(data, field));
}
