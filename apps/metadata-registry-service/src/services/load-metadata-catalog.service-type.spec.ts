import { resolveMetadataTypeDefinition } from '../../../../helpers/catalog/type-overrides';
import { SERVICE_TYPE_SPECIALTY_RELATIONS } from '../../../../helpers/excel/load-metadata-catalog';

describe('ServiceType catalog relation support', () => {
  it('defines ServiceType type with ALLOWED_FOR → Specialty (MULTI)', () => {
    const def = resolveMetadataTypeDefinition('ServiceType');
    expect(def.relation).toEqual({
      supportsRelations: true,
      relationType: 'ALLOWED_FOR',
      targetMetadataTypeCode: 'Specialty',
      relationFieldLabel: 'Allowed Specialties',
      selectionMode: 'MULTI',
      relationRequired: false,
    });
  });

  it('documents sample ServiceType → Specialty seed mappings for Excel-backed values', () => {
    expect(SERVICE_TYPE_SPECIALTY_RELATIONS).toEqual({
      CONSULTATION: ['CARDIOLOGY', 'ENDOCRINOLOGY'],
      PROCEDURE: ['SURGERY'],
    });
  });
});
