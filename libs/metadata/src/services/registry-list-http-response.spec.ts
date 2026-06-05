import type { MetadataTypeListItem } from '../models/types';
import { shapeRegistryListHttpResponse } from './metadata.service';

describe('shapeRegistryListHttpResponse', () => {
  const row = { metadataTypeCode: 'T' } as MetadataTypeListItem;

  it('returns a bare array when pagination is off', () => {
    const shaped = shapeRegistryListHttpResponse({ pagination: false, items: [row] }, [row]);
    expect(Array.isArray(shaped)).toBe(true);
    expect(shaped).toEqual([row]);
  });

  it('returns { items, nextPaginationKey } when paginated with a cursor', () => {
    const shaped = shapeRegistryListHttpResponse(
      { pagination: true, items: [row], nextPaginationKey: 'eyJhIjoxfQ' },
      [row],
    );
    expect(shaped).toEqual({ items: [row], nextPaginationKey: 'eyJhIjoxfQ' });
  });

  it('omits nextPaginationKey when paginated but cursor is undefined', () => {
    const shaped = shapeRegistryListHttpResponse({ pagination: true, items: [row] }, [row]);
    expect(shaped).toEqual({ items: [row] });
    expect(Object.prototype.hasOwnProperty.call(shaped, 'nextPaginationKey')).toBe(false);
  });
});
