import type { FhirHandlerOptions } from '@api-hub/middleware';

import { inferFhirResourceTypeForUser } from './fhir-user-resource-type';

/** Single-user read endpoints (getUser, getUserOrganization, getUserByExternalIdentity). */
export const fhirUserHandlerOptions: FhirHandlerOptions = {
  inferResourceType: inferFhirResourceTypeForUser,
};

/** User list endpoints that return a top-level array or `{ items: [] }`. */
export const fhirUserListHandlerOptions: FhirHandlerOptions = {
  inferResourceType: inferFhirResourceTypeForUser,
};

/** V2 user list envelope `{ data: { items: [] } }`. */
export const fhirV2UserListHandlerOptions: FhirHandlerOptions = {
  inferResourceType: inferFhirResourceTypeForUser,
  resourceListPath: 'data.items',
};

/** Create-user POST — inbound FHIR Practitioner/Patient bodies. */
export const fhirCreateUserHandlerOptions: FhirHandlerOptions = {
  inboundProfile: 'createUser',
  inferResourceType: inferFhirResourceTypeForUser,
};

/** Assign-doctor POST with inbound FHIR Bundle or canonical bodies. */
export const fhirAssignDoctorHandlerOptions: FhirHandlerOptions = {
  inboundProfile: 'assignDoctor',
};

/** Activate/deactivate POST — inbound FHIR Parameters only; response shape unchanged. */
export const fhirActivateDeactivateHandlerOptions: FhirHandlerOptions = {
  inboundProfile: 'activateDeactivate',
};

/** Friend/family endpoints mapped to RelatedPerson. */
export const fhirRelatedPersonHandlerOptions: FhirHandlerOptions = {
  resourceType: 'RelatedPerson',
};

/** Friend/family list responses `{ items: [] }` or top-level arrays. */
export const fhirRelatedPersonListHandlerOptions: FhirHandlerOptions = {
  resourceType: 'RelatedPerson',
  resourceListPath: 'items',
};

/** Organization role-count rows (POST organization-user-count). */
export const fhirOrganizationCountHandlerOptions: FhirHandlerOptions = {
  inferResourceType: () => 'Organization',
};

/** Pending appointment create — patient + doctor participants. */
export const fhirPendingAppointmentHandlerOptions: FhirHandlerOptions = {
  inferResourceType: inferFhirResourceTypeForUser,
  resourceListPath: 'participants',
};
