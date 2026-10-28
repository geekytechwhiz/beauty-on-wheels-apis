/**
 * Monetary unit conventions for Beauty on Wheels booking/payment.
 *
 * Catalog and booking snapshots historically store integer INR major units
 * (rupees) in fields named `totalMinor` / `amountMinor`. Example: ₹499 → 499.
 * That naming is retained for contract compatibility.
 *
 * Payment providers that use ISO 4217 minor units (paise for INR) receive
 * `providerAmountMinor`. Example: ₹499 → 49900 paise.
 *
 * Never trust a client-supplied amount for charging. Convert only from the
 * authoritative booking pricing snapshot.
 */

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND']);

/** Catalog/booking integer amount → ISO provider minor units (paise for INR). */
export function toProviderMinor(catalogAmount: number, currency: string): number {
  if (!Number.isFinite(catalogAmount) || catalogAmount < 0) {
    throw new Error('catalogAmount must be a non-negative finite number');
  }
  const code = currency.trim().toUpperCase();
  const rounded = Math.round(catalogAmount);
  if (ZERO_DECIMAL.has(code)) return rounded;
  return rounded * 100;
}

/** ISO provider minor units → catalog/booking integer amount. */
export function fromProviderMinor(providerMinor: number, currency: string): number {
  if (!Number.isInteger(providerMinor) || providerMinor < 0) {
    throw new Error('providerMinor must be a non-negative integer');
  }
  const code = currency.trim().toUpperCase();
  if (ZERO_DECIMAL.has(code)) return providerMinor;
  if (providerMinor % 100 !== 0) {
    throw new Error('providerMinor must align to whole catalog units for this currency');
  }
  return providerMinor / 100;
}

/** Display helper: catalog amount as a fixed 2-decimal major-unit string. */
export function formatMajorUnits(catalogAmount: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  if (ZERO_DECIMAL.has(code)) return `${Math.round(catalogAmount)}`;
  return (Math.round(catalogAmount * 100) / 100).toFixed(2);
}

export function assertProviderAmountMatches(
  catalogAmount: number,
  currency: string,
  providerMinor: number,
): void {
  const expected = toProviderMinor(catalogAmount, currency);
  if (expected !== providerMinor) {
    throw new Error(
      `Provider amount ${providerMinor} does not match catalog amount ${catalogAmount} ${currency} (expected ${expected})`,
    );
  }
}
