import { ValidationError } from '@api-hub/metadata';
import { metadataValuesByTypesSchema } from './metadataValuesByTypes.schema';

describe('metadataValuesByTypesSchema', () => {
  it('parses a valid array of metadataTypeCodes', () => {
    const input = metadataValuesByTypesSchema.parse({
      body: { metadataTypeCodes: ['Country', 'Language', 'Condition'] },
    });
    expect(input.metadataTypeCodes).toEqual(['Country', 'Language', 'Condition']);
  });

  it('trims whitespace around codes', () => {
    const input = metadataValuesByTypesSchema.parse({
      body: { metadataTypeCodes: ['  Country  ', 'Language'] },
    });
    expect(input.metadataTypeCodes).toEqual(['Country', 'Language']);
  });

  it('removes duplicate codes (first occurrence wins, order preserved)', () => {
    const input = metadataValuesByTypesSchema.parse({
      body: { metadataTypeCodes: ['Country', 'Language', 'Country', ' Country '] },
    });
    expect(input.metadataTypeCodes).toEqual(['Country', 'Language']);
  });

  it('rejects a missing body', () => {
    expect(() => metadataValuesByTypesSchema.parse({})).toThrow(ValidationError);
  });

  it('rejects a non-object body (array)', () => {
    expect(() => metadataValuesByTypesSchema.parse({ body: ['Country'] })).toThrow(ValidationError);
  });

  it('rejects when metadataTypeCodes is missing', () => {
    expect(() => metadataValuesByTypesSchema.parse({ body: {} })).toThrow(ValidationError);
  });

  it('rejects when metadataTypeCodes is not an array', () => {
    expect(() =>
      metadataValuesByTypesSchema.parse({ body: { metadataTypeCodes: 'Country' } }),
    ).toThrow(ValidationError);
  });

  it('rejects an empty array', () => {
    expect(() =>
      metadataValuesByTypesSchema.parse({ body: { metadataTypeCodes: [] } }),
    ).toThrow(ValidationError);
  });

  it('rejects a non-string / empty code entry', () => {
    expect(() =>
      metadataValuesByTypesSchema.parse({ body: { metadataTypeCodes: ['Country', ''] } }),
    ).toThrow(ValidationError);
    expect(() =>
      metadataValuesByTypesSchema.parse({ body: { metadataTypeCodes: ['Country', 123] } }),
    ).toThrow(ValidationError);
  });

  it('rejects free-text / invalid pattern codes', () => {
    expect(() =>
      metadataValuesByTypesSchema.parse({ body: { metadataTypeCodes: ['not a code!'] } }),
    ).toThrow(ValidationError);
    expect(() =>
      metadataValuesByTypesSchema.parse({ body: { metadataTypeCodes: ['country'] } }),
    ).toThrow(ValidationError);
  });
});
