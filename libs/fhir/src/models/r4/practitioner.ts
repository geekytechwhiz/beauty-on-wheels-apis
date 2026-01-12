/**
 * FHIR R4 Practitioner Resource
 * Based on FHIR R4 (4.0.1) specification
 */

import { Resource, Identifier, HumanName, ContactPoint, Address, CodeableConcept, Extension } from './common';

export interface Practitioner extends Resource {
  resourceType: 'Practitioner';
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  telecom?: ContactPoint[];
  address?: Address[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
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
  qualification?: Array<{
    identifier?: Identifier[];
    code: CodeableConcept;
    period?: {
      start?: string;
      end?: string;
    };
    issuer?: {
      reference?: string;
      display?: string;
    };
  }>;
  communication?: CodeableConcept[];
}

