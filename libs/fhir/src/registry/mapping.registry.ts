import basePatientMapping from '../mappings/base/patient.mapping.json';
import basePractitionerMapping from '../mappings/base/practitioner.mapping.json';
import trutechPatientMapping from '../mappings/clients/trutech/patient.mapping.json';
import trutechPractitionerMapping from '../mappings/clients/trutech/practitioner.mapping.json';

export interface ResourceMappingConfig {
  resourceType: string;
  canonical: string;
  mappings: Record<string, string>;
}

interface ClientMappings {
  [resourceType: string]: Partial<ResourceMappingConfig>;
}

/**
 * Registry for base and client-specific FHIR mapping configurations.
 *
 * Base mappings define the default canonical→FHIR field mapping for a resource.
 * Client mappings provide per-tenant overrides that are merged on resolution.
 */
export class MappingRegistry {
  private baseMappings = new Map<string, ResourceMappingConfig>();
  private clientMappings = new Map<string, ClientMappings>();

  registerBaseMapping(resourceType: string, mapping: ResourceMappingConfig) {
    const key = resourceType.trim();
    if (!key) return;
    this.baseMappings.set(key, mapping);
  }

  registerClientMapping(
    clientId: string,
    resourceType: string,
    mapping: Partial<ResourceMappingConfig>
  ) {
    const cid = clientId.trim();
    const rtype = resourceType.trim();
    if (!cid || !rtype) return;

    const existing = this.clientMappings.get(cid) ?? {};
    existing[rtype] = {
      ...(existing[rtype] ?? {}),
      ...mapping,
      mappings: {
        ...(existing[rtype]?.mappings ?? {}),
        ...(mapping.mappings ?? {}),
      },
    };
    this.clientMappings.set(cid, existing);
  }

  getBaseMapping(resourceType: string): ResourceMappingConfig | undefined {
    return this.baseMappings.get(resourceType.trim());
  }

  getClientMapping(
    clientId: string,
    resourceType: string
  ): Partial<ResourceMappingConfig> | undefined {
    return this.clientMappings.get(clientId.trim())?.[resourceType.trim()];
  }
}

export const defaultMappingRegistry = new MappingRegistry();

// Auto-register known mappings on module load so that the mapping resolver
// can be used without explicit registration from callers.
defaultMappingRegistry.registerBaseMapping(
  'Patient',
  basePatientMapping as ResourceMappingConfig
);

defaultMappingRegistry.registerBaseMapping(
  'Practitioner',
  basePractitionerMapping as ResourceMappingConfig
);

defaultMappingRegistry.registerClientMapping(
  'trutech',
  'Patient',
  trutechPatientMapping as Partial<ResourceMappingConfig>
);

defaultMappingRegistry.registerClientMapping(
  'trutech',
  'Practitioner',
  trutechPractitionerMapping as Partial<ResourceMappingConfig>
);

