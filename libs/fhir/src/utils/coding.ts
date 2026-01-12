/**
 * FHIR Coding Utilities
 */

import { Coding, CodeableConcept } from '../models/r4/common';

/**
 * Create a Coding
 */
export function createCoding(
  system: string,
  code: string,
  display?: string
): Coding {
  return {
    system,
    code,
    ...(display && { display }),
  };
}

/**
 * Create a CodeableConcept from a single coding
 */
export function createCodeableConcept(
  system: string,
  code: string,
  display?: string,
  text?: string
): CodeableConcept {
  return {
    coding: [createCoding(system, code, display)],
    ...(text && { text }),
  };
}

/**
 * Create a CodeableConcept from multiple codings
 */
export function createCodeableConceptFromCodings(
  codings: Coding[],
  text?: string
): CodeableConcept {
  return {
    coding: codings,
    ...(text && { text }),
  };
}

/**
 * Common coding systems
 */
export const CodingSystems = {
  GENDER: 'http://hl7.org/fhir/administrative-gender',
  MARITAL_STATUS: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus',
  ADDRESS_USE: 'http://hl7.org/fhir/address-use',
  ADDRESS_TYPE: 'http://hl7.org/fhir/address-type',
  CONTACT_POINT_SYSTEM: 'http://hl7.org/fhir/contact-point-system',
  CONTACT_POINT_USE: 'http://hl7.org/fhir/contact-point-use',
  NAME_USE: 'http://hl7.org/fhir/name-use',
  IDENTIFIER_USE: 'http://hl7.org/fhir/identifier-use',
  RELATIONSHIP: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
} as const;

