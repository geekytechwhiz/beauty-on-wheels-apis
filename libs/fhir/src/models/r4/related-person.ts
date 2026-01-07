/**
 * FHIR R4 RelatedPerson Resource
 * Based on FHIR R4 (4.0.1) specification
 */

import { Resource, Identifier, HumanName, ContactPoint, Address, CodeableConcept, Reference, Period } from './common';

export interface RelatedPerson extends Resource {
  resourceType: 'RelatedPerson';
  identifier?: Identifier[];
  active?: boolean;
  patient: Reference;
  relationship?: CodeableConcept[];
  name?: HumanName[];
  telecom?: ContactPoint[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: Address[];
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
  period?: Period;
  communication?: Array<{
    language: CodeableConcept;
    preferred?: boolean;
  }>;
}

