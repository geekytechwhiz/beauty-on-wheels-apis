export class ConfigRegistry {
  constructor(private readonly configs: Record<string, any>) {}

  get(resourceType: string) {
    return this.configs[resourceType];
  }
}