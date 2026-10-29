import { ValidationError } from '@api-hub/utils';

import { indianMobilesMatch, normalizeIndianMobile } from './indian-mobile';

describe('normalizeIndianMobile', () => {
  it('stores a national number as E.164', () => {
    expect(normalizeIndianMobile('9876543210')).toBe('+919876543210');
    expect(normalizeIndianMobile('+91 98765 43210')).toBe('+919876543210');
    expect(normalizeIndianMobile('919876543210')).toBe('+919876543210');
    expect(normalizeIndianMobile('09876543210')).toBe('+919876543210');
  });

  it('rejects numbers outside the Indian mobile range', () => {
    expect(() => normalizeIndianMobile('12345')).toThrow(ValidationError);
    expect(() => normalizeIndianMobile('5876543210')).toThrow(ValidationError);
    expect(() => normalizeIndianMobile('+14155552671')).toThrow(ValidationError);
  });

  it('matches stored numbers after normalization', () => {
    expect(indianMobilesMatch('9876543210', '+919876543210')).toBe(true);
    expect(indianMobilesMatch('+919876543211', '+919876543210')).toBe(false);
  });
});
