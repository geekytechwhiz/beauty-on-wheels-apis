import { asItems, nextTokenOf, unwrapData } from './http-client';
import { fromHttpStatus } from '../errors/channel-error';

describe('downstream envelopes', () => {
  it('unwraps the platform success envelope and list shapes', () => {
    const categories = unwrapData({
      success: true,
      data: { items: [{ id: 'cat1', name: 'Wash' }], nextToken: 'next' },
    });
    expect(asItems(categories)).toEqual([{ id: 'cat1', name: 'Wash' }]);
    expect(nextTokenOf(categories)).toBe('next');

    const vendors = unwrapData({
      success: true,
      data: { data: [{ vendorId: 'v1' }], pagination: { nextCursor: 'cursor' } },
    });
    expect(asItems(vendors)).toEqual([{ vendorId: 'v1' }]);
    expect(nextTokenOf(vendors)).toBe('cursor');
  });

  it('rejects an unsuccessful envelope', () => {
    expect(() => unwrapData({ success: false, data: null, error: { code: 'NOT_FOUND' } })).toThrow(/not successful/);
  });

  it('maps timeout as retryable', () => {
    expect(fromHttpStatus(504, 'catalog', '').retryable).toBe(true);
    expect(fromHttpStatus(409, 'booking', '').retryable).toBe(false);
  });
});
