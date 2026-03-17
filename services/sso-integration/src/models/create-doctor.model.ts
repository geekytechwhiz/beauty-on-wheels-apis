/**
 * Create Doctor domain model.
 * Produces a payload compatible with createUserSchema (user-service).
 * userType = "STAFF", userRole includes DOCTOR_ROLE_ID, namePrefix = "Dr".
 */

import { SourceSystem } from '../types/common/context.types';
import { DoctorCreationPayload } from '../types/user-creation.type';

/** Default working hours shape expected by createUserSchema */
export interface WorkingHoursDay {
  available: boolean;
  availableHours: Array<{ from: string; to: string }>;
}

/** Input for building a create-doctor payload from HMS data */
export interface CreateDoctorModelInput {
  /** Doctor display name (required) */
  name: string;
  /** Contact: email required for STAFF */
  contact: {
    email: string;
    phone?: string | null;
    phoneCode?: string;
  };
  /** Department (optional) */
  department?: string | null;
  /** Specialty (optional; config default often used) */
  specialty?: string;
  /** License number (optional) */
  licenseNumber?: string;
  /** Organization ID from configuration */
  organizationID: string;
  /** External identity */
  externalIdentity: {
    provider: string;
    externalId: string;
    subdomain?: string;
    externalHospitalId?: string;
    sourceSystem?: SourceSystem;
  };
  /** DOCTOR_ROLE_ID from configuration */
  doctorRoleId: string;
  /** namePrefix, default "Dr" */
  namePrefix?: string;
  /** Working hours (optional; from config default if not provided) */
  workingHours?: {
    monday: WorkingHoursDay;
    tuesday: WorkingHoursDay;
    wednesday: WorkingHoursDay;
    thursday: WorkingHoursDay;
    friday: WorkingHoursDay;
    saturday: WorkingHoursDay;
    sunday: WorkingHoursDay;
  };
  /** slotDurationInMinutes (optional) */
  slotDurationInMinutes?: number;
  /** bio (optional) */
  bio?: string;
}

function defaultWorkingHoursDay(available: boolean, availableHours: Array<{ from: string; to: string }>): WorkingHoursDay {
  return { available, availableHours };
}

/**
 * Builds a create-user payload for a doctor (STAFF).
 * Output passes createUserSchema validation (STAFF requires email).
 */
export function createDoctorModel(input: CreateDoctorModelInput): DoctorCreationPayload {
  const name = (input.name ?? '').toString().trim();
  if (!name) {
    throw new Error('CreateDoctorModel: name is required');
  }

  const email = (input.contact?.email ?? '').toString().trim();
  if (!email) {
    throw new Error('CreateDoctorModel: email is required for STAFF (createUserSchema)');
  }

  const defaultDay = defaultWorkingHoursDay(true, [{ from: '07:00', to: '21:00' }]);
  const workingHours = input.workingHours ?? {
    monday: defaultDay,
    tuesday: defaultDay,
    wednesday: defaultDay,
    thursday: defaultDay,
    friday: defaultDay,
    saturday: defaultDay,
    sunday: defaultDay,
  };

  const now = Date.now();
  const payload: DoctorCreationPayload = {
    userInfo: {
      name,
      namePrefix: input.namePrefix ?? 'Dr',
      contact: {
        email,
        phone: input.contact?.phone ? String(input.contact.phone).trim() : undefined,
        phoneCode: input.contact?.phoneCode,
      },
      department: input.department ?? undefined,
      specialty: input.specialty ?? 'general',
      licenseNumber: input.licenseNumber ?? '',
      workingHours,
      slotDurationInMinutes: input.slotDurationInMinutes ?? 15,
      bio: input.bio ?? '',
    },
    userRole: [input.doctorRoleId],
    invite: 'email',
    userType: 'STAFF',
    organizationID: input.organizationID,
    externalIdentity: {
      externalUserId: input.externalIdentity.externalId,
      externalHospitalId: input.externalIdentity.externalHospitalId,
      subdomain: input.externalIdentity.subdomain ?? '',
      sourceSystem: input.externalIdentity.sourceSystem ?? SourceSystem.HMS,
      provider: input.externalIdentity.provider,
    },
    role: input.doctorRoleId,
    source: 'HMS',
    email,
    phone: input.contact?.phone ? String(input.contact.phone).trim() : '',
    firstName: name,
    lastName: name,
    createdDate: now,
    modifiedDate: now,
  };

  return payload;
}
