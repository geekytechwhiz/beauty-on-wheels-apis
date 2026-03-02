export interface ProcessedPhoneNumber {
  phoneCode: string;
  phoneNumber: string;
}


export function processPhoneNumber(
  phone: string | undefined | null,
  defaultPhoneCode: string = '+27'
): ProcessedPhoneNumber {
  // Return defaults if phone is empty
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    return {
      phoneCode: defaultPhoneCode,
      phoneNumber: '',
    };
  }

  // Trim whitespace
  const cleaned = phone.trim();

  // If phone starts with "+27", extract it as phoneCode
  if (cleaned.startsWith('+27')) {
    return {
      phoneCode: '+27',
      phoneNumber: cleaned.slice(3).trim(), // Remove "+27" prefix
    };
  }

  // Otherwise, use default phoneCode and phone as phoneNumber
  return {
    phoneCode: defaultPhoneCode,
    phoneNumber: cleaned,
  };
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
