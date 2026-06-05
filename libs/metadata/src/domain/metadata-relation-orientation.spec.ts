import { resolveRelationStorageEndpoints } from './metadata-relation-orientation';

describe('resolveRelationStorageEndpoints', () => {
  it('stores Country → State for PARENT_CHILD when the edited subject is State', () => {
    const r = resolveRelationStorageEndpoints('PARENT_CHILD', 'State', 'KA', 'Country', 'IN');
    expect(r).toEqual({
      relationType: 'PARENT_CHILD',
      fromMetadataTypeCode: 'Country',
      fromMetadataValueCode: 'IN',
      toMetadataTypeCode: 'State',
      toMetadataValueCode: 'KA',
    });
  });

  it('stores State → City for PARENT_CHILD when the edited subject is City (reverse of catalog State–City)', () => {
    const r = resolveRelationStorageEndpoints('PARENT_CHILD', 'City', 'NYC', 'State', 'NY');
    expect(r).toEqual({
      relationType: 'PARENT_CHILD',
      fromMetadataTypeCode: 'State',
      fromMetadataValueCode: 'NY',
      toMetadataTypeCode: 'City',
      toMetadataValueCode: 'NYC',
    });
  });

  it('stores Device → Vital for SUPPORTED_BY when the edited subject is Device', () => {
    const r = resolveRelationStorageEndpoints('SUPPORTED_BY', 'Device', 'OMRON_X7', 'Vital', 'BP_SYSTOLIC');
    expect(r).toEqual({
      relationType: 'SUPPORTED_BY',
      fromMetadataTypeCode: 'Device',
      fromMetadataValueCode: 'OMRON_X7',
      toMetadataTypeCode: 'Vital',
      toMetadataValueCode: 'BP_SYSTOLIC',
    });
  });

  it('stores Currency → Country for VALID_IN when the edited subject is Country (reverse of catalog edge)', () => {
    const r = resolveRelationStorageEndpoints('VALID_IN', 'Country', 'US', 'Currency', 'USD');
    expect(r).toEqual({
      relationType: 'VALID_IN',
      fromMetadataTypeCode: 'Currency',
      fromMetadataValueCode: 'USD',
      toMetadataTypeCode: 'Country',
      toMetadataValueCode: 'US',
    });
  });

  it('stores Category → Condition for BELONGS_TO_CATEGORY when the edited subject is Condition (UI picks Category)', () => {
    const r = resolveRelationStorageEndpoints('BELONGS_TO_CATEGORY', 'Condition', 'ASTHMA', 'Category', 'RESP');
    expect(r).toEqual({
      relationType: 'BELONGS_TO_CATEGORY',
      fromMetadataTypeCode: 'Category',
      fromMetadataValueCode: 'RESP',
      toMetadataTypeCode: 'Condition',
      toMetadataValueCode: 'ASTHMA',
    });
  });
});
