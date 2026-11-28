import { assertVendorId, parseVendorHomeQuery } from './vendor-home.query';

describe('vendor home query validation', () => {
  it('rejects an invalid vendorId', () => {
    expect(() => assertVendorId('')).toThrow(/vendorId/);
    expect(() => assertVendorId('bad id')).toThrow(/vendorId/);
  });

  it('rejects an invalid date', () => {
    expect(() => parseVendorHomeQuery({ date: '13-11-2026' })).toThrow(/date/);
    expect(() => parseVendorHomeQuery({ date: '2026-13-40' })).toThrow(/date/);
  });

  it('rejects an invalid upcomingDays', () => {
    expect(() => parseVendorHomeQuery({ upcomingDays: '0' })).toThrow(/upcomingDays/);
    expect(() => parseVendorHomeQuery({ upcomingDays: '8' })).toThrow(/upcomingDays/);
  });

  it('defaults upcomingDays to 3', () => {
    expect(parseVendorHomeQuery({})).toEqual({ upcomingDays: 3 });
  });
});
