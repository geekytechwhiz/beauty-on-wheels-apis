/**
 * Patient Adapter
 * Converts internal User DTO to FHIR R4 Patient resource
 */

import { Patient } from '../../models/r4/patient';
import { User } from '../../types/internal';
import { createReference, createOrganizationReference } from '../../utils/reference';
import { createCodeableConcept, CodingSystems } from '../../utils/coding';
import { toFhirDate, getCurrentFhirDateTime } from '../../utils/date';
import { HumanName, ContactPoint, Address, Identifier } from '../../models/r4/common';

/**
 * Convert internal User to FHIR Patient
 */
export function toPatient(user: User, baseUrl?: string): Patient {
  const patientId = user.userID;

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
  if (user.additionalEmailIDs?.length) {
    user.additionalEmailIDs.forEach((email) => {
      telecom.push({
        system: 'email',
        value: email,
        use: 'temp',
      });
    });
  }
  if (user.additionalPhoneNumbers?.length) {
    user.additionalPhoneNumbers.forEach((phone) => {
      telecom.push({
        system: 'phone',
        value: phone,
        use: 'temp',
      });
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
      use: 'official',
      system: baseUrl ? `${baseUrl}/fhir/Patient` : undefined,
      value: user.userID,
    });
  }
  if (user.mrn) {
    identifiers.push({
      use: 'usual',
      type: createCodeableConcept(
        'http://terminology.hl7.org/CodeSystem/v2-0203',
        'MR',
        'Medical Record Number'
      ),
      value: user.mrn,
    });
  }
  if (user.emailAddress) {
    identifiers.push({
      use: 'secondary',
      system: 'http://hl7.org/fhir/sid/email',
      value: user.emailAddress,
    });
  }

  const contacts: Patient['contact'] = [];
  if (user.emergencyContact) {
    const emergencyContact = user.emergencyContact as Record<string, unknown>;
    const contactName = emergencyContact.name as string | undefined;
    const contactPhone = emergencyContact.phone as string | undefined;
    const contactRelationship = emergencyContact.relationship as string | undefined;

    if (contactName || contactPhone) {
      contacts.push({
        relationship: contactRelationship
          ? [
              createCodeableConcept(
                CodingSystems.RELATIONSHIP,
                contactRelationship.toLowerCase().replace(/\s+/g, '-'),
                contactRelationship
              ),
            ]
          : undefined,
        name: contactName
          ? {
              text: contactName,
            }
          : undefined,
        telecom: contactPhone
          ? [
              {
                system: 'phone',
                value: contactPhone,
                use: 'home',
              },
            ]
          : undefined,
      });
    }
  }

  const patient: Patient = {
    resourceType: 'Patient',
    id: patientId,
    ...(identifiers.length > 0 && { identifier: identifiers }),
    active: user.isActive !== false,
    ...(names.length > 0 && { name: names }),
    ...(telecom.length > 0 && { telecom }),
    ...(user.gender && {
      gender: mapGender(user.gender),
    }),
    ...(user.dateOfBirth && { birthDate: toFhirDate(user.dateOfBirth) }),
    ...(addresses.length > 0 && { address: addresses }),
    ...(user.maritalStatus && {
      maritalStatus: createCodeableConcept(
        CodingSystems.MARITAL_STATUS,
        user.maritalStatus.toLowerCase().replace(/\s+/g, '-'),
        user.maritalStatus
      ),
    }),
    ...(user.organizationID && {
      managingOrganization: createOrganizationReference(user.organizationID),
    }),
    meta: {
      lastUpdated: getCurrentFhirDateTime(),
      ...(baseUrl && { source: baseUrl }),
    },
    ...(contacts.length > 0 && { contact: contacts }),
  };

  return patient;
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

