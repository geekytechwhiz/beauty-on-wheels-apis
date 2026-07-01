import { resolveMetadataTypeDefinition } from '../../../../helpers/catalog/type-overrides';

describe('ServiceType catalog config', () => {
  it('defines ServiceType without relation config', () => {
    const def = resolveMetadataTypeDefinition('ServiceType');
    expect(def.metadataTypeCode).toBe('ServiceType');
    expect(def.relation).toBeUndefined();
    expect(def.applicableModules).toEqual(['SERVICE', 'PACKAGE', 'APPOINTMENT']);
  });
});
