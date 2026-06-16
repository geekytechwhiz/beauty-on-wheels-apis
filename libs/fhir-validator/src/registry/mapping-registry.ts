export class MappingRegistry {
  constructor(private readonly mappings: Record<string, any>) {}

  get(resourceType: string) {
    return this.mappings[resourceType];
  }
}