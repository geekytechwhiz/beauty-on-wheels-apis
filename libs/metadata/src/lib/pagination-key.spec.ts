import { ValidationError } from '../domain/errors';
import { decodePaginationKey, encodePaginationKey } from './pagination-key';

describe('pagination-key', () => {
  it('encodePaginationKey returns undefined for empty key', () => {
    expect(encodePaginationKey(undefined)).toBeUndefined();
    expect(encodePaginationKey({})).toBeUndefined();
  });

  it('encode and decode round-trip for PK/SK', () => {
    const lek = { PK: 'METADATA_TYPES', SK: 'TYPE#FOO' };
    const token = encodePaginationKey(lek);
    expect(typeof token).toBe('string');
    expect(decodePaginationKey(token!, 'PK', 'SK')).toEqual(lek);
  });

  it('decodePaginationKey throws ValidationError for invalid payload', () => {
    expect(() => decodePaginationKey('not-base64!!!', 'PK', 'SK')).toThrow(ValidationError);
  });

  it('decodePaginationKey throws when primary key attributes missing', () => {
    const bad = Buffer.from(JSON.stringify({ PK: 'METADATA_TYPES' }), 'utf8').toString('base64url');
    expect(() => decodePaginationKey(bad, 'PK', 'SK')).toThrow(ValidationError);
  });
});
