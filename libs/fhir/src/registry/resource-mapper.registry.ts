import type { ResourceMapper } from '../interfaces/ResourceMapper';
import { FhirTransformationService } from '../services/fhir-transformation.service';
import { OrganizationMapper } from '../mappers/OrganizationMapper';
import { PatientMapper } from '../mappers/PatientMapper';
import { PractitionerMapper } from '../mappers/PractitionerMapper';
import { RelatedPersonMapper } from '../mappers/RelatedPersonMapper';

export function createDefaultResourceMappers(
  transformationService: FhirTransformationService,
): ResourceMapper[] {
  return [
    new PatientMapper(transformationService),
    new PractitionerMapper(transformationService),
    new RelatedPersonMapper(transformationService),
    new OrganizationMapper(transformationService),
  ];
}
