import { splitPhoneNumber } from '@api-hub/utils';

export interface ProcessedPhoneNumber {
  phoneCode: string;
  phoneNumber: string;
}

export function processPhoneNumber(
  phone: string | undefined | null,
  phoneCode: string,
): ProcessedPhoneNumber {

  //Check Phone Code is Valid

  if (!phoneCode || typeof phoneCode !== 'string' || phoneCode.trim().length === 0) {
    throw new Error('Invalid phone code');
  }

  //Check Phone Number is Valid
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    throw new Error('Phone number is required');
  }

  const cleaned = phone.trim();

  try {
    // Prefer shared libphonenumber-based helper for consistent parsing
    const { phoneCode, phoneNumber } = splitPhoneNumber(cleaned, 'ZA');

    return {
      phoneCode: phoneCode ,
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
      phoneCode: phoneCode,
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
