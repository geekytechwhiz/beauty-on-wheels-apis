import type { FhirHandlerOptions } from '@api-hub/middleware';

import { inferFhirResourceTypeForOrganization } from './fhir-organization-resource-type';

/** getOrganization — composite Bundle (Organization, Practitioner, Schedule, vitals, …). */
export const fhirOrganizationDetailHandlerOptions: FhirHandlerOptions = {
  outboundProfile: 'organizationDetail',
};

/** Single-organization read/update/status responses (field mapping only). */
export const fhirOrganizationHandlerOptions: FhirHandlerOptions = {
  inferResourceType: inferFhirResourceTypeForOrganization,
};

/** Organization list endpoints returning `{ items: [] }`. */
export const fhirOrganizationListHandlerOptions: FhirHandlerOptions = {
  inferResourceType: inferFhirResourceTypeForOrganization,
  resourceListPath: 'items',
};

/** Create-organization POST — inbound FHIR Organization → canonical before validation. */
export const fhirCreateOrganizationHandlerOptions: FhirHandlerOptions = {
  inboundProfile: 'createOrganization',
  resourceType: 'Organization',
  inferResourceType: inferFhirResourceTypeForOrganization,
};

/** Organization count rows (GET organization count). */
export const fhirOrganizationCountHandlerOptions: FhirHandlerOptions = {
  inferResourceType: () => 'Organization',
};

/** Organization metadata catalog (GET/PUT organization metadata). */
export const fhirOrganizationMetadataHandlerOptions: FhirHandlerOptions = {
  outboundProfile: 'organizationMetadata',
};
