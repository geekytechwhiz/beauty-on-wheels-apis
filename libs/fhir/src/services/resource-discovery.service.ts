import type { ResourceMapper } from '../interfaces/ResourceMapper';
import { createDefaultResourceMappers } from '../registry/resource-mapper.registry';

export class ResourceDiscoveryService {
  constructor(private readonly mappers: ResourceMapper[]) {}

  static createDefault(
    transformationService: Parameters<typeof createDefaultResourceMappers>[0],
  ): ResourceDiscoveryService {
    return new ResourceDiscoveryService(
      createDefaultResourceMappers(transformationService),
    );
  }

  discover(data: unknown, explicitTypes?: string[]): ResourceMapper[] {
    if (explicitTypes?.length) {
      return this.mappers.filter((mapper) =>
        explicitTypes.includes(mapper.resourceType),
      );
    }

    return this.mappers.filter((mapper) => mapper.supports(data));
  }
}
