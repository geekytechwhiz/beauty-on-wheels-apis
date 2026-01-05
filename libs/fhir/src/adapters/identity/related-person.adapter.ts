/**
 * RelatedPerson Adapter
 * Converts internal User DTO to FHIR R4 RelatedPerson resource
 */

import { RelatedPerson } from '../../models/r4/related-person';
import { User } from '../../types/internal';
import { createReference, createPatientReference } from '../../utils/reference';
import { createCodeableConcept, CodingSystems } from '../../utils/coding';
import { toFhirDate, getCurrentFhirDateTime } from '../../utils/date';
import { HumanName, ContactPoint, Address, Identifier } from '../../models/r4/common';

/**
 * Convert internal User to FHIR RelatedPerson
 * Requires a patient reference to establish the relationship
 */
export function toRelatedPerson(
  user: User,
  patientId: string,
  relationship?: string,
  baseUrl?: string
): RelatedPerson {
  const relatedPersonId = user.userID;

  const names: HumanName[] = [];
  if (user.firstName || user.lastName || user.fullName) {
    const given: string[] = [];
    if (user.firstName) {
      given.push(user.firstName);
    }
    if (user.middleName) {
      given.push(user.middleName);
    }
    const name: HumanName = {
      use: 'usual',
      ...(given.length > 0 && { given }),
      ...(user.lastName && { family: user.lastName }),
      ...(user.namePrefix && { prefix: [user.namePrefix] }),
      ...(user.fullName && !user.firstName && !user.lastName && { text: user.fullName }),
    };
    if (name.given?.length || name.family || name.text) {
      names.push(name);
    }
  }

  const telecom: ContactPoint[] = [];
  if (user.emailAddress) {
    telecom.push({
      system: 'email',
      value: user.emailAddress,
      use: 'home',
    });
  }
  if (user.phoneNumber) {
    telecom.push({
      system: 'phone',
      value: user.phoneCode ? `${user.phoneCode}${user.phoneNumber}` : user.phoneNumber,
      use: 'mobile',
    });
  }

  const addresses: Address[] = [];
  if (user.address || user.street || user.city || user.state || user.postalCode || user.country) {
    const address: Address = {
      use: 'home',
      type: 'both',
      ...(user.street && { line: [user.street] }),
      ...(user.address && !user.street && { line: [user.address] }),
      ...(user.city && { city: user.city }),
      ...(user.state && { state: user.state }),
      ...(user.stateCode && { state: user.stateCode }),
      ...(user.postalCode && { postalCode: user.postalCode }),
      ...(user.zip && !user.postalCode && { postalCode: user.zip }),
      ...(user.country && { country: user.country }),
      ...(user.countryCode && { country: user.countryCode }),
    };
    if (address.line?.length || address.city || address.state || address.postalCode || address.country) {
      addresses.push(address);
    }
  }

  const identifiers: Identifier[] = [];
  if (user.userID) {
    identifiers.push({
      use: 'usual',
      system: baseUrl ? `${baseUrl}/fhir/RelatedPerson` : undefined,
      value: user.userID,
    });
  }
  if (user.emailAddress) {
    identifiers.push({
      use: 'secondary',
      system: 'http://hl7.org/fhir/sid/email',
      value: user.emailAddress,
    });
  }

  const relationships: RelatedPerson['relationship'] = [];
  if (relationship) {
    relationships.push(
      createCodeableConcept(
        CodingSystems.RELATIONSHIP,
        relationship.toLowerCase().replace(/\s+/g, '-'),
        relationship
      )
    );
  } else if (user.emergencyContact) {
    const emergencyContact = user.emergencyContact as Record<string, unknown>;
    const contactRelationship = emergencyContact.relationship as string | undefined;
    if (contactRelationship) {
      relationships.push(
        createCodeableConcept(
          CodingSystems.RELATIONSHIP,
          contactRelationship.toLowerCase().replace(/\s+/g, '-'),
          contactRelationship
        )
      );
    }
  }

  const relatedPerson: RelatedPerson = {
    resourceType: 'RelatedPerson',
    id: relatedPersonId,
    ...(identifiers.length > 0 && { identifier: identifiers }),
    active: user.isActive !== false,
    patient: createPatientReference(patientId),
    ...(relationships.length > 0 && { relationship: relationships }),
    ...(names.length > 0 && { name: names }),
    ...(telecom.length > 0 && { telecom }),
    ...(user.gender && {
      gender: mapGender(user.gender),
    }),
    ...(user.dateOfBirth && { birthDate: toFhirDate(user.dateOfBirth) }),
    ...(addresses.length > 0 && { address: addresses }),
    ...(user.language && {
      communication: [
        {
          language: createCodeableConcept(
            'http://terminology.hl7.org/CodeSystem/languages',
            user.language,
            user.language
          ),
          preferred: true,
        },
      ],
    }),
    meta: {
      lastUpdated: getCurrentFhirDateTime(),
      ...(baseUrl && { source: baseUrl }),
    },
  };

  return relatedPerson;
}

/**
 * Map internal gender to FHIR gender
 */
function mapGender(gender: string): 'male' | 'female' | 'other' | 'unknown' {
  const normalized = gender.toLowerCase().trim();
  if (normalized === 'm' || normalized === 'male' || normalized === 'man') {
    return 'male';
  }
  if (normalized === 'f' || normalized === 'female' || normalized === 'woman') {
    return 'female';
  }
  if (normalized === 'other' || normalized === 'non-binary' || normalized === 'nonbinary') {
    return 'other';
  }
  return 'unknown';
}

