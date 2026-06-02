 
import { ResourceConfig } from '../types/resource.types';
import { mergeMappings } from './merge-mappings';
import { MappingRegistry } from '../registry/mapping.registry';
import { DefaultClientMappingRegistry } from '../registry/client-mapping.registry';

 

export class MappingResolver {
  
  constructor(
    private readonly registry: MappingRegistry,
    private readonly clientRegistry: DefaultClientMappingRegistry,
  ) {}

  resolve(
    resourceType: string,
    clientId = '',
    version = 'R4',
  ): ResourceConfig {
    const baseMapping = this.registry.get(resourceType, version);

    if (!baseMapping) {
      throw new Error(
        `Mapping not found:

          resource=${resourceType}

          version=${version}

          client=${clientId}`,
      );
    }

    if (!clientId) {
      return baseMapping;
    }

    const clientOverride =
      this.clientRegistry.get(clientId, resourceType, version);

    return mergeMappings(baseMapping, clientOverride);
  }
}
