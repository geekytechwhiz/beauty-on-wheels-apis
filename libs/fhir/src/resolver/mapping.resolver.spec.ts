import { MappingResolver } from './mapping.resolver';
import { mergeMappings } from './merge-mappings';
import {
  clientPatientOverrideFixture,
  patientMappingFixture,
} from '../testing/mapping.fixtures';

describe('mergeMappings', () => {
  it('returns base mapping when client override is absent', () => {
    expect(mergeMappings(patientMappingFixture)).toBe(patientMappingFixture);
  });

  it('overrides fields matched by target path', () => {
    const merged = mergeMappings(
      patientMappingFixture,
      clientPatientOverrideFixture,
    );

    const idField = merged.fields.find((field) => field.target === 'id');
    expect(idField?.source).toBe('externalPatientId');
  });

  it('appends client-only fields', () => {
    const merged = mergeMappings(patientMappingFixture, {
      resource: 'Patient',
      version: 'R4',
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
    const merged = mergeMappings(patientMappingFixture, {
      resource: 'Patient',
      version: 'R4',
      profile: 'http://example.org/StructureDefinition/CustomPatient',
      fields: [
        {
          source: 'externalPatientId',
          target: 'id',
          fieldType: 'string',
        },
      ],
    });

    expect(merged.profile).toBe(
      'http://example.org/StructureDefinition/CustomPatient',
    );
  });
});

describe('MappingResolver', () => {
  const registry = {
    Patient: {
      R4: patientMappingFixture,
    },
  };

  it('resolves default mapping without client id', () => {
    const resolver = new MappingResolver(registry);

    const mapping = resolver.resolve('Patient');

    expect(mapping).toBe(patientMappingFixture);
    expect(mapping.version).toBe('R4');
  });

  it('merges client overrides when client id is provided', () => {
    const clientRegistry = {
      example: {
        Patient: {
          R4: clientPatientOverrideFixture,
        },
      },
    };
    const resolver = new MappingResolver(registry, clientRegistry);

    const mapping = resolver.resolve('Patient', 'example');

    expect(
      mapping.fields.find((field) => field.target === 'id')?.source,
    ).toBe('externalPatientId');
  });

  it('supports explicit version selection', () => {
    const resolver = new MappingResolver(registry);

    const mapping = resolver.resolve('Patient', '', 'R4');

    expect(mapping.version).toBe('R4');
  });

  it('throws when resource mapping is missing', () => {
    const resolver = new MappingResolver(registry);

    expect(() => resolver.resolve('Practitioner')).toThrow(/resource=Practitioner/);
  });

  it('throws when version mapping is missing', () => {
    const resolver = new MappingResolver(registry);

    expect(() => resolver.resolve('Patient', '', 'R5')).toThrow(/version=R5/);
  });
});
