import { DefaultClientMappingRegistry } from '../registry/client-mapping.registry';
import { MappingRegistry } from '../registry/mapping.registry';
import { MappingResolver } from './mapping.resolver';
import { mergeMappings } from './merge-mappings';
import {
  asResourceConfig,
  clientPatientOverrideFixture,
  patientMappingFixture,
} from '../testing/mapping.fixtures';

describe('mergeMappings', () => {
  const baseConfig = asResourceConfig(patientMappingFixture);

  it('returns base mapping when client override is absent', () => {
    expect(mergeMappings(baseConfig)).toBe(baseConfig);
  });

  it('overrides fields matched by target path', () => {
    const merged = mergeMappings(
      baseConfig,
      asResourceConfig(clientPatientOverrideFixture),
    );

    const idField = merged.fields.find((field) => field.target === 'id');
    expect(idField?.source).toBe('externalPatientId');
  });

  it('appends client-only fields', () => {
    const merged = mergeMappings(baseConfig, {
      resource: 'Patient',
      version: 'R4',
      profile: [],
      validation: { enabled: true, level: 'BASIC', requiredFields: [] },
      detection: { enabled: false, strategy: 'ANY', fields: [] },
      mapping: { file: 'Patient.mapping.json' },
      aliases: {},
      references: [],
      extensions: [],
      transformers: [],
      clientOverrides: true,
      metadata: {},
      fields: [
        {
          source: 'tenantCode',
          target: 'identifier.0.value',
          fieldType: 'string',
        },
      ],
    });

    expect(
      merged.fields.some((field) => field.target === 'identifier.0.value'),
    ).toBe(true);
  });

  it('prefers client profile when override includes fields', () => {
    const merged = mergeMappings(baseConfig, {
      resource: 'Patient',
      version: 'R4',
      profile: ['http://example.org/StructureDefinition/CustomPatient'],
      validation: { enabled: true, level: 'BASIC', requiredFields: [] },
      detection: { enabled: false, strategy: 'ANY', fields: [] },
      mapping: { file: 'Patient.mapping.json' },
      aliases: {},
      references: [],
      extensions: [],
      transformers: [],
      clientOverrides: true,
      metadata: {},
      fields: [
        {
          source: 'externalPatientId',
          target: 'id',
          fieldType: 'string',
        },
      ],
    });

    expect(merged.profile).toEqual([
      'http://example.org/StructureDefinition/CustomPatient',
    ]);
  });
});

describe('MappingResolver', () => {
  function createRegistry() {
    const registry = new MappingRegistry();
    registry.register(asResourceConfig(patientMappingFixture));
    return registry;
  }

  function createClientRegistry() {
    const registry = new DefaultClientMappingRegistry();
    registry.register(
      'example',
      asResourceConfig(clientPatientOverrideFixture),
    );
    return registry;
  }

  it('resolves default mapping without client id', () => {
    const resolver = new MappingResolver(createRegistry());

    const mapping = resolver.resolve('Patient');

    expect(mapping.resource).toBe('Patient');
    expect(mapping.version).toBe('R4');
  });

  it('merges client overrides when client id is provided', () => {
    const resolver = new MappingResolver(createRegistry(), createClientRegistry());

    const mapping = resolver.resolve('Patient', 'example');

    expect(
      mapping.fields.find((field) => field.target === 'id')?.source,
    ).toBe('externalPatientId');
  });

  it('supports explicit version selection', () => {
    const resolver = new MappingResolver(createRegistry());

    const mapping = resolver.resolve('Patient', '', 'R4');

    expect(mapping.version).toBe('R4');
  });

  it('throws when resource mapping is missing', () => {
    const resolver = new MappingResolver(createRegistry());

    expect(() => resolver.resolve('Practitioner')).toThrow(/resource=Practitioner/);
  });

  it('throws when version mapping is missing', () => {
    const resolver = new MappingResolver(createRegistry());

    expect(() => resolver.resolve('Patient', '', 'R5')).toThrow(/version=R5/);
  });
});
