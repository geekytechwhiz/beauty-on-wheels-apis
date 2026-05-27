import { ResourceConfig } from '../types/resource.types';

/** Subset of {@link ResourceConfig} used by {@link GenericMapper}. */
export type ResourceMappingConfig = Pick<
  ResourceConfig,
  'resource' | 'version' | 'profile' | 'fields' | 'extensions'
>;

export class MappingRegistry {

  private readonly mappings =
    new Map<string, ResourceConfig>();

  private readonly clientMappings =
    new Map<string, ResourceConfig>();


  register(
    config: ResourceConfig
  ): void {

    const key =
      `${config.resource}:${config.version}`;

    this.mappings.set(
      key,
      config
    );

  }


  registerClientOverride(
    clientId: string,
    config: ResourceConfig
  ): void {

    const key =
      `${clientId}:${config.resource}:${config.version}`;

    this.clientMappings.set(
      key,
      config
    );

  }


  get(
    resource: string,
    version = 'R4'
  ): ResourceConfig | undefined {

    return this.mappings.get(
      `${resource}:${version}`
    );

  }


  getClientOverride(
    clientId: string,
    resource: string,
    version = 'R4'
  ): ResourceConfig | undefined {

    return this.clientMappings.get(
      `${clientId}:${resource}:${version}`
    );

  }

}

export const mappingRegistry =
  new MappingRegistry();