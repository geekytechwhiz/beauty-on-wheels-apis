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

  it('documents ServiceType → Specialty seed mappings for Excel-backed values', () => {
    expect(Object.keys(SERVICE_TYPE_SPECIALTY_RELATIONS).sort()).toEqual(
      ['CONSULTATION', 'EDUCATION', 'LAB_REVIEW', 'MONITORING', 'OTHER', 'PROCEDURE', 'REVIEW'].sort(),
    );
    expect(SERVICE_TYPE_SPECIALTY_RELATIONS.CONSULTATION).toContain('CARDIOLOGY');
    expect(SERVICE_TYPE_SPECIALTY_RELATIONS.PROCEDURE).toContain('SURGERY');
  });
});
