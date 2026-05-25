import { ResourceConfig } from '../types/resource.types';

class ResourceRegistry {
  private resources = new Map<string, ResourceConfig>();

  register(config: ResourceConfig) {
    this.resources.set(config.resource, config);
  }

  get(resource: string) {
    return this.resources.get(resource);
  }

  getAll() {
    return Array.from(this.resources.values());
  }

  has(resource: string) {
    return this.resources.has(resource);
  }
}

export const resourceRegistry = new ResourceRegistry();
