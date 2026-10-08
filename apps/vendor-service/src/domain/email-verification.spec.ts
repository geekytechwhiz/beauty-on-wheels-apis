import {
  EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
  firstNameFromContactName,
  generateVendorEmailVerificationOtp,
} from './email-verification';

describe('vendor email verification helpers', () => {
  it('uses PENDING_VERIFICATION as the eligible vendor status', () => {
    expect(EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS).toBe('PENDING_VERIFICATION');
  });

  it('uses a 24-hour verification window', () => {
    expect(VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES).toBe(24 * 60);
  });

  it('generates a 6-digit OTP', () => {
    expect(generateVendorEmailVerificationOtp('vendor-1')).toMatch(/^vendor-1\.[A-Za-z0-9_-]{43}$/);
  });

  it('takes the first token of the contact name', () => {
    expect(firstNameFromContactName('Priya Sharma')).toBe('Priya');
    expect(firstNameFromContactName('  prasanth  ')).toBe('prasanth');
    expect(firstNameFromContactName('')).toBe('');
    expect(firstNameFromContactName(undefined)).toBe('');
  });
});
