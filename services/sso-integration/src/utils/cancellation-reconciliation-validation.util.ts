/**
 * Validates date range fields used in cancellation reconciliation messages.
 * Accepts epoch-ms strings (numeric) or parseable ISO/date strings.
 */
export function isValidReconciliationDateField(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) {
    return true;
  }
  const parsed = Date.parse(trimmed);
  return !Number.isNaN(parsed);
}

export function hasNonEmptyTrimmed(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
