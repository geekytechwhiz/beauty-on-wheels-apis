import { CapabilityService } from '@api-hub/fhir';
import { withApiHandler, successResponse } from '@api-hub/middleware';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const capabilityService = new CapabilityService({
  profiles: {
    Patient: ['http://hl7.org/fhir/StructureDefinition/Patient'],
    Observation: ['http://hl7.org/fhir/StructureDefinition/Observation'],
    Practitioner: ['http://hl7.org/fhir/StructureDefinition/Practitioner'],
    RelatedPerson: ['http://hl7.org/fhir/StructureDefinition/RelatedPerson'],
    Organization: ['http://hl7.org/fhir/StructureDefinition/Organization'],
    PractitionerRole: [
      'http://hl7.org/fhir/StructureDefinition/PractitionerRole',
    ],
    Appointment: ['http://hl7.org/fhir/StructureDefinition/Appointment'],
  },
});

const handler = async () => {
  return capabilityService.getMetadata();
};

export const main = withApiHandler(
  {
    operation: 'fhirMetadata',
  },
  async (req) => {
    return await (handler as any)(req);
  },
);
