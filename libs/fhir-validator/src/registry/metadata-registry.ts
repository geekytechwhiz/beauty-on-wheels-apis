export interface ResourceMetadataRegistry {
  get(resourceType: string): any;
}

export class MetadataRegistry implements ResourceMetadataRegistry {
  constructor(private readonly metadataMap: Record<string, any>) {}

  get(resourceType: string) {
    return this.metadataMap[resourceType];
  }
}