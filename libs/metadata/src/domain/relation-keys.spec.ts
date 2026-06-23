import {
  decodeRelationId,
  encodeRelationId,
  parseRelationSortKey,
  relationPartitionKey,
  relationSortKey,
} from './relation-keys';

describe('relation-keys', () => {
  it('builds partition and sort keys', () => {
    const pk = relationPartitionKey('Country', 'INDIA');
    expect(pk).toBe('RELATION#Country#INDIA');
    const sk = relationSortKey('PARENT_CHILD', 'State', 'KARNATAKA');
    expect(sk).toBe('CHILD#State#KARNATAKA');
  });

  it('round-trips id encoding', () => {
    const pk = 'RELATION#Country#INDIA';
    const sk = 'CHILD#State#KARNATAKA';
    const id = encodeRelationId(pk, sk);
    expect(decodeRelationId(id)).toEqual({ pk, sk });
  });

  it('parseRelationSortKey extracts parts', () => {
    expect(parseRelationSortKey('SUPPORTS#Vital#BP_SYSTOLIC')).toEqual({
      skPrefix: 'SUPPORTS',
      toMetadataTypeCode: 'Vital',
      toMetadataValueCode: 'BP_SYSTOLIC',
    });
    expect(parseRelationSortKey('ALLOWED_FOR#Specialty#CARDIOLOGY')).toEqual({
      skPrefix: 'ALLOWED_FOR',
      toMetadataTypeCode: 'Specialty',
      toMetadataValueCode: 'CARDIOLOGY',
    });
  });

  it('builds ALLOWED_FOR sort keys', () => {
    const sk = relationSortKey('ALLOWED_FOR', 'Specialty', 'CARDIOLOGY');
    expect(sk).toBe('ALLOWED_FOR#Specialty#CARDIOLOGY');
  });
});
