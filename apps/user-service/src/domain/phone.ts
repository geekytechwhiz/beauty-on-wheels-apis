import { ValidationError } from '@api-hub/utils';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Accepts E.164, or the same digits when a query-string `+` was decoded as a space.
 * National numbers without a country code are rejected.
 */
export function requireE164(phone: string): string {
  const compact = phone.trim().replace(/[\s()-]/g, '');
  if (!compact) {
    throw new ValidationError('phone must be a valid E.164 number');
  }

  const candidate = compact.startsWith('+') ? compact : `+${compact}`;
  const parsed = parsePhoneNumberFromString(candidate);

  if (!parsed?.isValid()) {
    throw new ValidationError('phone must be a valid E.164 number');
  }

  return parsed.number;
}
