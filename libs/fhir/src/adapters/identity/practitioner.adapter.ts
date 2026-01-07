/**
 * Practitioner Adapter
 * Converts internal User DTO to FHIR R4 Practitioner resource
 */

import { Practitioner } from '../../models/r4/practitioner';
import { User } from '../../types/internal';
import { createCodeableConcept } from '../../utils/coding';
import { toFhirDate, getCurrentFhirDateTime } from '../../utils/date';
import { HumanName, ContactPoint, Address, Identifier } from '../../models/r4/common';

/**
 * Convert internal User to FHIR Practitioner
 * Assumes userType indicates practitioner role
 */
export function toPractitioner(user: User, baseUrl?: string): Practitioner {
  const practitionerId = user.userID;

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
      use: 'official',
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
      use: 'work',
    });
  }
  if (user.phoneNumber) {
    telecom.push({
      system: 'phone',
      value: user.phoneCode ? `${user.phoneCode}${user.phoneNumber}` : user.phoneNumber,
      use: 'work',
    });
  }

  const addresses: Address[] = [];
  if (user.address || user.street || user.city || user.state || user.postalCode || user.country) {
    const address: Address = {
      use: 'work',
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
      use: 'official',
      system: baseUrl ? `${baseUrl}/fhir/Practitioner` : undefined,
      value: user.userID,
    });
  }
  if (user.licenseNumber) {
    identifiers.push({
      use: 'official',
      type: createCodeableConcept(
        'http://terminology.hl7.org/CodeSystem/v2-0203',
        'LN',
        'License Number'
      ),
      value: user.licenseNumber,
    });
  }
  if (user.emailAddress) {
    identifiers.push({
      use: 'secondary',
      system: 'http://hl7.org/fhir/sid/email',
      value: user.emailAddress,
    });
  }

  const qualifications: Practitioner['qualification'] = [];
  if (user.specialty) {
    qualifications.push({
      code: createCodeableConcept(
        'http://snomed.info/sct',
        user.specialty.toLowerCase().replace(/\s+/g, '-'),
        user.specialty
      ),
    });
  }
  if (user.licenseNumber) {
    qualifications.push({
      identifier: [
        {
          use: 'official',
          value: user.licenseNumber,
        },
      ],
      code: createCodeableConcept(
        'http://terminology.hl7.org/CodeSystem/v2-0360',
        'LIC',
        'License'
      ),
    });
  }

  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: practitionerId,
    ...(identifiers.length > 0 && { identifier: identifiers }),
    active: user.isActive !== false,
    ...(names.length > 0 && { name: names }),
    ...(telecom.length > 0 && { telecom }),
    ...(addresses.length > 0 && { address: addresses }),
    ...(user.gender && {
      gender: mapGender(user.gender),
    }),
    ...(user.dateOfBirth && { birthDate: toFhirDate(user.dateOfBirth) }),
    ...(qualifications.length > 0 && { qualification: qualifications }),
    ...(user.specialty && {
      communication: [
        createCodeableConcept(
          'http://terminology.hl7.org/CodeSystem/languages',
          user.language || 'en',
          user.language || 'English'
        ),
      ],
    }),
    meta: {
      lastUpdated: getCurrentFhirDateTime(),
      ...(baseUrl && { source: baseUrl }),
    },
  };

  return practitioner;
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

