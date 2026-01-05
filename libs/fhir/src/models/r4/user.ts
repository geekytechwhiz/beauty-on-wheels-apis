/**
 * FHIR R4 User Resource
 * Based on FHIR R4 (4.0.1) specification
 * Note: FHIR R4 doesn't have a standard "User" resource, but this follows
 * the Person resource pattern for user identity representation
 */

import { Resource, Identifier, HumanName, ContactPoint, Address, Reference, CodeableConcept, Extension } from './common';

export interface User extends Resource {
  resourceType: 'User';
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
  managingOrganization?: Reference;
  link?: Array<{
    other: Reference;
    type: 'replaced-by' | 'replaces' | 'refer' | 'seealso';
  }>;
  extension?: Extension[];
}

