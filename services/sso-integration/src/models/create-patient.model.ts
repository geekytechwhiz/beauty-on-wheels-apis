/**
 * Create Patient domain model.
 * Produces a payload compatible with createUserSchema (user-service).
 * userType = "USER", userRole includes PATIENT_ROLE_ID.
 */

import { SourceSystem } from '../types/common/context.types';
import { ExternalIdentity, PatientCreationPayload } from '../types/user-creation.type';
import { PHONE_CODE } from '../utils/constants';

/** Input for building a create-patient payload from HMS or event data */
export interface CreatePatientModelInput {
  /** Patient display name (required) */
  name: string;
  /** Contact phone (optional; at least one of email or phone required for USER) */
  contact?: {
    phone?: string | null;
    email?: string | null;
    phoneCode?: string;
  };
  /** Gender (optional) */
  gender?: string | null;
  /** Date of birth (optional) */
  dateOfBirth?: string | null;
  /** Organization ID from configuration */
  organizationID: string;
  /** External identity: provider and external id */
    externalIdentity: ExternalIdentity;
  /** PATIENT_ROLE_ID from configuration */
  patientRoleId: string;
}

/**
 * Builds a create-user payload for a patient.
 * Output passes createUserSchema validation (userType USER, at least one of email/phone).
 */
export function createPatientModel(input: CreatePatientModelInput): PatientCreationPayload {
  const name = (input.name ?? '').toString().trim();
  if (!name) {
    throw new Error('CreatePatientModel: name is required');
  }

  const email = input.contact?.email ?? '';
  const phone = input.contact?.phone ?? '';
  const hasEmail = typeof email === 'string' && email.trim() !== '';
  const hasPhone = typeof phone === 'string' && phone.trim() !== '';
  if (!hasEmail && !hasPhone) {
    throw new Error(
      'CreatePatientModel: either email or phone is required for USER (createUserSchema)',
    );
  }

  const payload: PatientCreationPayload = {
    userInfo: {
      name,
      namePrefix: '',
      gender: input.gender ?? undefined,
      dateOfBirth: input.dateOfBirth ?? undefined,
      contact: {
        email: hasEmail ? String(email).trim() : undefined,
        phone: hasPhone ? String(phone).trim() : undefined,
        phoneCode: input.contact?.phoneCode ?? '+260',
      },
      emergencyContact: {},
      friendNFamily: {},
      medicalHistory: {
        allergies: [],
        chronicDiseases: [],
        symptoms: [],
      },
    },
    userRole: [input.patientRoleId],
    userType: 'USER',
    invite: hasPhone ? 'phone' : 'email',
    organizationID: input.organizationID,
    externalIdentity: input.externalIdentity,
  };

  return payload;
}
