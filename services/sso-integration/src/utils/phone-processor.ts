import { splitPhoneNumber } from '@api-hub/utils';

export interface ProcessedPhoneNumber {
  phoneCode: string;
  phoneNumber: string;
}

export function processPhoneNumber(
  phone: string | undefined | null,
  defaultPhoneCode = '+27'
): ProcessedPhoneNumber {
  // Return defaults if phone is empty
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    return {
      phoneCode: defaultPhoneCode,
      phoneNumber: '',
    };
  }

  const cleaned = phone.trim();

  try {
    // Prefer shared libphonenumber-based helper for consistent parsing
    const { phoneCode, phoneNumber } = splitPhoneNumber(cleaned, 'ZA');

    return {
      phoneCode: phoneCode || defaultPhoneCode,
      phoneNumber,
    };
  } catch {
    // Fallback to previous simple behavior if parsing fails
    if (cleaned.startsWith('+27')) {
      return {
        phoneCode: '+27',
        phoneNumber: cleaned.slice(3).trim(), // Remove "+27" prefix
      };
    }

    return {
      phoneCode: defaultPhoneCode,
      phoneNumber: cleaned,
    };
  }
}

/**
 * Validate phone number format
 * @param phoneNumber - Phone number to validate
 * @returns true if valid, false otherwise
 */
export function isValidPhoneNumber(phoneNumber: string): boolean {
  if (!phoneNumber || phoneNumber.trim().length === 0) {
    return false;
  }

  // Basic validation: should contain only digits
  return /^\d+$/.test(phoneNumber);
}
