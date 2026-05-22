import {
  ResourceMappingConfig,
} from '../registry/mapping.registry';

import { mergeMappings } from './merge-mappings';

export interface MappingRegistry {
  [resource: string]: {
    [version: string]: ResourceMappingConfig;
  };
}

export interface ClientMappingRegistry {
  [clientId: string]: MappingRegistry;
}

export class MappingResolver {
  constructor(
    private readonly registry: MappingRegistry,
    private readonly clientRegistry: ClientMappingRegistry = {},
  ) {}

  resolve(
    resourceType: string,
    clientId = '',
    version = 'R4',
  ): ResourceMappingConfig {
    const baseMapping = this.registry[resourceType]?.[version];

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
      this.clientRegistry[clientId]?.[resourceType]?.[version];

    return mergeMappings(baseMapping, clientOverride);
  }
}
