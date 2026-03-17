/**
 * Mapping layer: HMS payloads → domain model inputs → createUser/assignDoctor payloads.
 * Uses CreatePatientModel, CreateDoctorModel, and AssignDoctorModel.
 */

import { getSSOConfig } from '../config/sso-config';
import { buildAssignDoctorModel, type AssignDoctorModelInput } from '../models/assign-doctor.model';
import { createDoctorModel, type CreateDoctorModelInput } from '../models/create-doctor.model';
import { createPatientModel, type CreatePatientModelInput } from '../models/create-patient.model';
import type { Appointment, SSORequestContext } from '../types';
import { SourceSystem } from '../types/common/context.types';
import { PatientCreationEvent } from '../types/events';
import type { AssignDoctorPayload, DoctorCreationPayload, PatientCreationPayload } from '../types/user-creation.type';
import { buildExternalIdentity } from '../utils/context-builder.util';
import { getOrganizationId, loadTenantDetails } from '../utils/helper';
import { processPhoneNumber } from '../utils/phone-processor';

/**
 * Maps a patient creation event (HMS) to a create-user payload for a patient.
 * Uses CreatePatientModel; output is compatible with createUserSchema.
 */
export function mapHmsPatientToCreatePatientModel(event: PatientCreationEvent): PatientCreationPayload {
  const { patient, organizationID,  } = event.data;
  const subdomain = (event.data as { subdomain?: string }).subdomain ?? '';
  const tenant = loadTenantDetails(subdomain);

  const input: CreatePatientModelInput = {
    name: (patient.name ?? '').toString().trim(),
    contact: {
      email: patient.email ?? undefined,
      phone: patient.phone ?? undefined,
      phoneCode: patient.phoneCode ?? '+27',
    },
    gender: patient.gender ?? undefined,
    dateOfBirth: patient.dob ?? undefined,
    organizationID: organizationID ?? tenant.organizationId,
    externalIdentity: buildExternalIdentity(patient.id?.toString()),
    patientRoleId: tenant.patientRoleId,
  };

  return createPatientModel(input);
}

/**
 * Maps HMS appointment (doctor) + context to a create-user payload for a doctor.
 * Uses CreateDoctorModel; output is compatible with createUserSchema.
 */
export function mapHmsDoctorToCreateDoctorModel(
  appointment: Appointment,
  context: SSORequestContext,
): DoctorCreationPayload {
  const config = getSSOConfig();
  const subdomain = context.integration?.subdomain ?? '';
  const tenant = loadTenantDetails(subdomain);
  const doctor = appointment.doctor;

  const doctorName = (doctor.name ?? '').toString().trim();
  const doctorEmail = (doctor.email ?? '').toString().trim();
  if (!doctorName) {
    throw new Error('mapHmsDoctorToCreateDoctorModel: doctor name is required');
  }
  if (!doctorEmail) {
    throw new Error('mapHmsDoctorToCreateDoctorModel: doctor email is required for STAFF');
  }

  const phoneProcessed = processPhoneNumber(doctor.phone, config.patient.phoneCode);
  const defaultDay = {
    available: config.doctor.workingHours.available,
    availableHours: config.doctor.workingHours.availableHours,
  };
  const workingHours = {
    monday: defaultDay,
    tuesday: defaultDay,
    wednesday: defaultDay,
    thursday: defaultDay,
    friday: defaultDay,
    saturday: defaultDay,
    sunday: defaultDay,
  };

  const input: CreateDoctorModelInput = {
    name: doctorName,
    contact: {
      email: doctorEmail,
      phone: phoneProcessed.phoneNumber ?? undefined,
      phoneCode: phoneProcessed.phoneCode,
    },
    department: doctor.department ?? undefined,
    specialty: config.doctor.specialty,
    licenseNumber: config.doctor.licenseNumber,
    organizationID: config.defaultOrganizationID,
    externalIdentity: {
      provider: context.integration?.providerId ?? tenant.provider,
      externalId: String(doctor.id),
      subdomain: context.integration?.subdomain ?? tenant.subdomain,
      externalHospitalId: context.integration?.externalHospitalId,
      sourceSystem: SourceSystem.HMS,
    },
    doctorRoleId: tenant.doctorRoleId,
    namePrefix: config.doctor.namePrefix,
    workingHours,
    slotDurationInMinutes: config.doctor.slotDurationInMinutes,
    bio: config.doctor.bio,
  };

  return createDoctorModel(input);
}

/**
 * Maps HMS appointment (patient) + context to a create-user payload for a patient.
 * Uses CreatePatientModel. Use when creating a patient from the sync flow (appointment processor).
 */
export function mapHmsAppointmentPatientToCreatePatientModel(
  appointment: Appointment,
  context: SSORequestContext,
): PatientCreationPayload {
  const config = getSSOConfig();
  const subdomain = context.integration?.subdomain ?? '';
  const tenant = loadTenantDetails(subdomain);
  const patient = appointment.patient;
  const organizationID =
    getOrganizationId(context.integration.subdomain) ||
    tenant.organizationId;

  const input: CreatePatientModelInput = {
    name: (patient.name ?? '').toString().trim(),
    contact: {
      email: patient.email ?? undefined,
      phone: patient.phone ?? undefined,
      phoneCode: config.patient.phoneCode,
    },
    gender: patient.gender ?? undefined,
    dateOfBirth: undefined,
    organizationID,
    externalIdentity: buildExternalIdentity(patient.id?.toString() ),
    patientRoleId: tenant.patientRoleId,
  };

  return createPatientModel(input);
}

/**
 * Builds an assign-doctor payload from doctor and patient user IDs and optional display info.
 * Ensures sender and receiver are different (assignDoctorSchema).
 */
export function buildAssignDoctorPayload(input: AssignDoctorModelInput): AssignDoctorPayload {
  return buildAssignDoctorModel(input);
}

 