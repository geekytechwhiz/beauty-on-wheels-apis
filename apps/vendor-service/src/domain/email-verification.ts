import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Verification links are valid for 24 hours. */
export const VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES = 24 * 60;

export const EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS =
  'PENDING_VERIFICATION' as const;

export function hasValidRegisteredEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Kept under the legacy `Otp` field name for the already deployed email event
 * contract.  This is an opaque, high-entropy bearer token rather than a
 * guessable six digit code.
 */
export function generateVendorEmailVerificationOtp(vendorId?: string): string {
  const secret = randomBytes(32).toString('base64url');
  // The unguessable token carries a routing hint so the public verification
  // endpoint can find its single-table profile without a scan or a token GSI.
  return vendorId ? `${vendorId}.${secret}` : secret;
}

export function vendorIdFromVerificationToken(token: string): string | undefined {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return undefined;
  return token.slice(0, separator);
}

export function hashVendorEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function matchesVendorEmailVerificationToken(
  token: string,
  expectedHash: string | undefined,
  legacyToken: string | undefined,
): boolean {
  const expected = expectedHash ?? (legacyToken ? hashVendorEmailVerificationToken(legacyToken) : undefined);
  if (!expected) {
    return false;
  }
  const actual = hashVendorEmailVerificationToken(token);
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function firstNameFromContactName(contactName: unknown): string {
  if (typeof contactName !== 'string') {
    return '';
  }

  const trimmed = contactName.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.split(/\s+/)[0] ?? '';
}
