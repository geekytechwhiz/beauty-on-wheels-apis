import { randomInt } from 'crypto';

export const VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES = 10;

export const CONFIRMED_VENDOR_STATUS = 'ACTIVE' as const;

export function generateVendorEmailVerificationOtp(): string {
  return randomInt(100000, 1000000).toString();
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
