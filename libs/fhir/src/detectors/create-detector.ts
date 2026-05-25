import type { ResourceDetector } from '../interfaces/ResourceDetector';
import type { ResourceMapper } from '../interfaces/ResourceMapper';

export class MapperResourceDetector implements ResourceDetector {
  constructor(private readonly mapper: ResourceMapper) {}

  get resourceType(): string {
    return this.mapper.resourceType;
  }

  canHandle(data: unknown): boolean {
    return this.mapper.supports(data);
  }
}

export function createDetector(mapper: ResourceMapper): ResourceDetector {
  return new MapperResourceDetector(mapper);
}
