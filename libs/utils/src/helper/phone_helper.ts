import {
    parsePhoneNumberFromString,
    CountryCode,
    PhoneNumber
  } from 'libphonenumber-js';
  
  export interface PhoneDetails {
    input: string;
    e164: string;
    phoneCode: string;
    nationalNumber: string;
    country?: CountryCode;
    isValid: boolean;
  }
  
  /**
   * Normalize and validate phone number
   * Returns structured phone information
   */
  export function normalizePhoneNumber(
    phone?: string | null,
    defaultCountry: CountryCode = 'ZA'
  ): PhoneDetails {
  
    if (!phone || phone.trim().length === 0) {
      return {
        input: '',
        e164: '',
        phoneCode: '',
        nationalNumber: '',
        isValid: false
      };
    }
  
    const cleaned = phone.trim();
  
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  
    if (!parsed) {
      return {
        input: cleaned,
        e164: '',
        phoneCode: '',
        nationalNumber: cleaned,
        isValid: false
      };
    }
  
    return mapPhoneDetails(parsed, cleaned);
  }
  
  /**
   * Convert phone to E.164 format (required for Cognito)
   */
  export function toE164(
    phone?: string | null,
    defaultCountry: CountryCode = 'ZA'
  ): string {
  
    const parsed = parsePhoneNumberFromString(phone || '', defaultCountry);
  
    if (!parsed || !parsed.isValid()) {
      return '';
    }
  
    return parsed.number;
  }
  
  /**
   * Validate phone number
   */
  export function isValidPhoneNumber(
    phone?: string | null,
    defaultCountry: CountryCode = 'ZA'
  ): boolean {
  
    const parsed = parsePhoneNumberFromString(phone || '', defaultCountry);
  
    return parsed?.isValid() ?? false;
  }
  
  /**
   * Extract phone code and national number
   */
  export function splitPhoneNumber(
    phone?: string | null,
    defaultCountry: CountryCode = 'ZA'
  ): { phoneCode: string; phoneNumber: string } {
  
    const parsed = parsePhoneNumberFromString(phone || '', defaultCountry);
  
    if (!parsed) {
      return {
        phoneCode: '',
        phoneNumber: phone || ''
      };
    }
  
    return {
      phoneCode: `+${parsed.countryCallingCode}`,
      phoneNumber: parsed.nationalNumber
    };
  }
  
  /**
   * Format number for display
   */
  export function formatPhoneInternational(
    phone?: string | null,
    defaultCountry: CountryCode = 'ZA'
  ): string {
  
    const parsed = parsePhoneNumberFromString(phone || '', defaultCountry);
  
    if (!parsed || !parsed.isValid()) {
      return phone || '';
    }
  
    return parsed.formatInternational();
  }
  
  /**
   * Internal helper
   */
  function mapPhoneDetails(parsed: PhoneNumber, original: string): PhoneDetails {
  
    return {
      input: original,
      e164: parsed.number,
      phoneCode: `+${parsed.countryCallingCode}`,
      nationalNumber: parsed.nationalNumber,
      country: parsed.country,
      isValid: parsed.isValid()
    };
  }

  export function cognitoPhone(phone: string, countryCode: CountryCode): string {
    if (phone.startsWith('+')) {
      return phone;
    }
    return toE164(phone, countryCode);
  }
 