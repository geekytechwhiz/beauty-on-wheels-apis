/**
 * FHIR R4 Patient Resource
 * Based on FHIR R4 (4.0.1) specification
 */

import { Resource, Identifier, HumanName, ContactPoint, Address, Reference, CodeableConcept, Extension, Period } from './common';

export interface Patient extends Resource {
  resourceType: 'Patient';
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  telecom?: ContactPoint[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  deceasedBoolean?: boolean;
  deceasedDateTime?: string;
  address?: Address[];
  maritalStatus?: CodeableConcept;
  multipleBirthBoolean?: boolean;
  multipleBirthInteger?: number;
  photo?: Array<{
    contentType?: string;
    language?: string;
    data?: string;
    url?: string;
    size?: number;
    hash?: string;
    title?: string;
    creation?: string;
  }>;
  contact?: Array<{
    relationship?: CodeableConcept[];
    name?: HumanName;
    telecom?: ContactPoint[];
    address?: Address;
    gender?: 'male' | 'female' | 'other' | 'unknown';
    organization?: Reference;
    period?: Period;
  }>;
  communication?: Array<{
    language: CodeableConcept;
    preferred?: boolean;
  }>;
  generalPractitioner?: Reference[];
  managingOrganization?: Reference;
  link?: Array<{
    other: Reference;
    type: 'replaced-by' | 'replaces' | 'refer' | 'seealso';
  }>;
}

