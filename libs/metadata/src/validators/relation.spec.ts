import { assertValidRelationType, validateRelationPairing, RELATION_TYPE_ALLOWED_PAIRS } from './relation';

describe('relation validator', () => {
  it('rejects bad relationType', () => {
    expect(() => assertValidRelationType('UNKNOWN')).toThrow();
  });

  it('validates known Country → State as PARENT_CHILD', () => {
    expect(
      () =>
        validateRelationPairing({
          relationType: 'PARENT_CHILD',
          fromMetadataTypeCode: 'Country',
          fromMetadataValueCode: 'INDIA',
          toMetadataTypeCode: 'State',
          toMetadataValueCode: 'KARNATAKA',
        }),
    ).not.toThrow();
  });

  it('rejects disallowed type pair for relationType', () => {
    expect(() =>
      validateRelationPairing({
        relationType: 'PARENT_CHILD',
        fromMetadataTypeCode: 'Device',
        fromMetadataValueCode: 'A',
        toMetadataTypeCode: 'Vital',
        toMetadataValueCode: 'B',
      }),
    ).toThrow();
  });

  it('exposes an allow list per type', () => {
    expect(RELATION_TYPE_ALLOWED_PAIRS.SUPPORTED_BY[0]).toEqual({ from: 'Device', to: 'Vital' });
  });
});
