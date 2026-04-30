import { MappingRegistry, ResourceMappingConfig } from '../registry/mapping.registry';

function deepMergeMappings(
  base: ResourceMappingConfig,
  override?: Partial<ResourceMappingConfig>
): ResourceMappingConfig {
  if (!override) return base;

  return {
    resourceType: override.resourceType ?? base.resourceType,
    canonical: override.canonical ?? base.canonical,
    mappings: {
      ...base.mappings,
      ...(override.mappings ?? {}),
    },
  };
}

export class MappingResolver {
  constructor(private readonly registry: MappingRegistry) {}

  resolve(resourceType: string, clientId?: string): ResourceMappingConfig | undefined {
    const base = this.registry.getBaseMapping(resourceType);
    if (!base) return undefined;
    if (!clientId) return base;

    const client = this.registry.getClientMapping(clientId, resourceType);
    return deepMergeMappings(base, client);
  }
}

