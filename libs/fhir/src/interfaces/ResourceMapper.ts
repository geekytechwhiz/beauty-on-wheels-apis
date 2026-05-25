export type FHIRResource = Record<string, unknown>;

export interface ResourceMapper<T = unknown> {
  resourceType: string;
  supports(data: T): boolean;
  map(data: T, clientId?: string): Promise<FHIRResource>;
}
