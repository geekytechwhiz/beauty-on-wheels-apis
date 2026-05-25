import exampleClientPatient from '../mappings/clients/example/R4/Patient.mapping.json';
import observationMapping from '../mappings/R4/Observation.mapping.json';
import organizationMapping from '../mappings/R4/Organization.mapping.json';
import patientMapping from '../mappings/R4/Patient.mapping.json';
import practitionerMapping from '../mappings/R4/Practitioner.mapping.json';
import relatedPersonMapping from '../mappings/R4/RelatedPerson.mapping.json';
import { clientMappingRegistry } from '../registry/client-mapping.registry';
import { mappingRegistry } from '../registry/mapping.registry';
import { resourceRegistry } from '../registry/resource-registry';
import type { MappingField, ResourceConfig } from '../types/resource.types';

import { bootstrapRegistry } from './bootstrap-registry';
import { CURATED_DETECTION } from './curated-detection';

type CuratedMappingJson = {
  resource: string;
  version: string;
  profile?: string | string[];
  fields?: ResourceConfig['fields'];
  extensions?: ResourceConfig['extensions'];
};

const CURATED_MAPPINGS: CuratedMappingJson[] = [
  patientMapping,
  practitionerMapping,
  organizationMapping,
  relatedPersonMapping,
  observationMapping,
];

function asProfileArray(profile: string | string[] | undefined): string[] {
  if (!profile) {
    return [];
  }

  return Array.isArray(profile) ? profile : [profile];
}

function mergeCuratedMapping(mapping: CuratedMappingJson): ResourceConfig {
  const base =
    resourceRegistry.get(mapping.resource) ??
    ({
      resource: mapping.resource,
      version: mapping.version,
      profile: asProfileArray(mapping.profile),
      validation: { enabled: true, level: 'BASIC', requiredFields: [] },
      detection: CURATED_DETECTION[mapping.resource] ?? {
        enabled: false,
        strategy: 'ANY',
        fields: [],
      },
      mapping: { file: `${mapping.resource}.mapping.json` },
      aliases: {},
      references: [],
      extensions: [],
      transformers: [],
      clientOverrides: true,
      metadata: { curated: true },
      fields: [],
    } satisfies ResourceConfig);

  return {
    ...base,
    profile: asProfileArray(mapping.profile).length
      ? asProfileArray(mapping.profile)
      : base.profile,
    fields: mapping.fields ?? base.fields,
    extensions: mapping.extensions ?? base.extensions,
    detection: CURATED_DETECTION[mapping.resource] ?? base.detection,
  };
}

/**
 * Loads generated resource configs and curated R4 mappings into registries.
 * Called once at library import from `src/index.ts`.
 */
export function bootstrapFhirLibrary(): void {
  bootstrapRegistry();

  for (const mapping of CURATED_MAPPINGS) {
    const merged = mergeCuratedMapping(mapping);
    mappingRegistry.register(merged);
    resourceRegistry.register(merged);
  }

  clientMappingRegistry.register('example', {
    resource: 'Patient',
    version: 'R4',
    profile: asProfileArray(patientMapping.profile),
    validation: { enabled: true, level: 'BASIC', requiredFields: [] },
    detection: CURATED_DETECTION.Patient,
    mapping: { file: 'Patient.mapping.json' },
    aliases: {},
    references: [],
    extensions: [],
    transformers: [],
    clientOverrides: true,
    metadata: { curated: true, clientOverride: true },
    fields: exampleClientPatient.fields as MappingField[] ?? [],
  });
}
