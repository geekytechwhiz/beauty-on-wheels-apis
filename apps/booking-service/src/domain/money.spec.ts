import {
  assertProviderAmountMatches,
  formatMajorUnits,
  fromProviderMinor,
  toProviderMinor,
} from './money';

describe('money units', () => {
  it('converts INR catalog rupees to Razorpay paise', () => {
    expect(toProviderMinor(499, 'INR')).toBe(49900);
    expect(toProviderMinor(499.4, 'inr')).toBe(49900);
    expect(toProviderMinor(0, 'INR')).toBe(0);
  });

  it('converts paise back to catalog rupees', () => {
    expect(fromProviderMinor(49900, 'INR')).toBe(499);
    expect(fromProviderMinor(100, 'INR')).toBe(1);
  });

  it('rejects fractional paise that cannot map to whole catalog units', () => {
    expect(() => fromProviderMinor(49950, 'INR')).toThrow(/align/);
  });

  it('keeps zero-decimal currencies unscaled', () => {
    expect(toProviderMinor(1500, 'JPY')).toBe(1500);
    expect(fromProviderMinor(1500, 'JPY')).toBe(1500);
  });

  it('verifies provider amounts against the booking snapshot', () => {
    expect(() => assertProviderAmountMatches(499, 'INR', 49900)).not.toThrow();
    expect(() => assertProviderAmountMatches(499, 'INR', 499)).toThrow(/does not match/);
  });

  it('formats major units for display and refund math', () => {
    expect(formatMajorUnits(499, 'INR')).toBe('499.00');
    expect(formatMajorUnits(499.1, 'INR')).toBe('499.10');
    expect(formatMajorUnits(1500, 'JPY')).toBe('1500');
  });
});
