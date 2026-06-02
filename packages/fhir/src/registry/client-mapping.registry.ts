import {
    ClientMappingRegistry
  } from '../types/resource.types';
  
  import {
    ResourceConfig
  } from '../types/resource.types';
  
  
  export class DefaultClientMappingRegistry
  implements ClientMappingRegistry {
  
    private readonly mappings =
      new Map<string, ResourceConfig>();
  
  
    register(
      clientId: string,
      config: ResourceConfig
    ): void {
  
      const key =
        `${clientId}:${config.resource}:${config.version}`;
  
      this.mappings.set(
        key,
        config
      );
  
    }
  
  
    get(
      clientId: string,
      resource: string,
      version='R4'
    ): ResourceConfig | undefined {
  
      return this.mappings.get(
        `${clientId}:${resource}:${version}`
      );
  
    }
  
  
    has(
      clientId: string,
      resource: string,
      version='R4'
    ): boolean {
  
      return this.mappings.has(
        `${clientId}:${resource}:${version}`
      );
  
    }
  
  
    getAll(
      clientId:string
    ): ResourceConfig[] {
  
      return Array
        .from(
          this.mappings.entries()
        )
        .filter(
          ([key])=>
            key.startsWith(
              `${clientId}:`
            )
        )
        .map(
          ([_,value])=>value
        );
  
    }
  
  }
  
  export const clientMappingRegistry =
    new DefaultClientMappingRegistry();