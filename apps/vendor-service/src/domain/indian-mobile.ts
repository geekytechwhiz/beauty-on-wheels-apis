import { ValidationError } from '@api-hub/utils';

const NATIONAL = /^[6-9]\d{9}$/;

/**
 * Indian mobile numbers are stored as E.164. Accepts a national number,
 * a leading 0, or a 91 country code.
 */
export function normalizeIndianMobile(input: string): string {
  const digits = input.replace(/\D/g, '');
  const national = digits.length === 12 && digits.startsWith('91')
    ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0')
      ? digits.slice(1)
      : digits;

  if (!NATIONAL.test(national)) {
    throw new ValidationError('Enter a valid Indian mobile number');
  }

  return `+91${national}`;
}

export function indianMobilesMatch(stored: string, normalized: string): boolean {
  if (stored === normalized) return true;
  try {
    return normalizeIndianMobile(stored) === normalized;
  } catch {
    return false;
  }
}
