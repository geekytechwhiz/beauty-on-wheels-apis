import {
  CONFIRMED_VENDOR_STATUS,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
  firstNameFromContactName,
  generateVendorEmailVerificationOtp,
} from './email-verification';

describe('vendor email verification helpers', () => {
  it('uses ACTIVE as the confirmed vendor status', () => {
    expect(CONFIRMED_VENDOR_STATUS).toBe('ACTIVE');
  });

  it('uses a 10-minute verification window', () => {
    expect(VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES).toBe(10);
  });

  it('generates a 6-digit OTP', () => {
    expect(generateVendorEmailVerificationOtp()).toMatch(/^\d{6}$/);
  });

  it('takes the first token of the contact name', () => {
    expect(firstNameFromContactName('Priya Sharma')).toBe('Priya');
    expect(firstNameFromContactName('  prasanth  ')).toBe('prasanth');
    expect(firstNameFromContactName('')).toBe('');
    expect(firstNameFromContactName(undefined)).toBe('');
  });
});
