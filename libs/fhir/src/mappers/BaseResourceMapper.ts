import type { FhirTransformationService } from '../services/fhir-transformation.service';
import type { FHIRResource, ResourceMapper } from '../interfaces/ResourceMapper';

export abstract class BaseResourceMapper implements ResourceMapper {
  abstract readonly resourceType: string;

  constructor(
    protected readonly transformationService: FhirTransformationService,
  ) {}

  abstract supports(data: unknown): boolean;

  async map(data: unknown, clientId?: string): Promise<FHIRResource> {
    return this.transformationService.transformCanonicalToFhir(
      this.resourceType,
      data,
      clientId,
      { validate: false },
    );
  }
}
