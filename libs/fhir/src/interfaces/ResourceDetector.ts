export interface ResourceDetector {
  canHandle(data: unknown): boolean;
  resourceType: string;
}
