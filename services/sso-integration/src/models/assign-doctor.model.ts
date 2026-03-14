/**
 * Assign Doctor domain model.
 * Produces a payload compatible with assignDoctorSchema (user-service).
 * Ensures sender (doctor) and receiver (patient) are never the same.
 */

import { AssignDoctorPayload } from '../types/user-creation.type';

/** Input for building an assign-doctor payload */
export interface AssignDoctorModelInput {
  /** Organization ID (required) */
  organizationId: string;
  /** Doctor user ID (sender) */
  doctorUserId: string;
  /** Patient user ID (receiver) */
  patientUserId: string;
  /** Optional doctor display info */
  doctor?: {
    name?: string;
    email?: string;
    userType?: string;
    presenceStatus?: string;
  };
  /** Optional patient display info */
  patient?: {
    name?: string;
    email?: string;
    profileImage?: string;
    userType?: string;
    presenceStatus?: string;
  };
  isReferred?: boolean;
}

/**
 * Builds an assign-doctor payload for the user service.
 * Fails if doctorUserId === patientUserId (assignDoctorSchema refinement).
 */
export function buildAssignDoctorModel(input: AssignDoctorModelInput): AssignDoctorPayload {
  const doctorUserId = String(input.doctorUserId).trim();
  const patientUserId = String(input.patientUserId).trim();

  if (!doctorUserId || !patientUserId) {
    throw new Error('AssignDoctorModel: doctorUserId and patientUserId are required');
  }

  if (doctorUserId === patientUserId) {
    throw new Error(
      'AssignDoctorModel: sender (doctor) and receiver (patient) must be different users (assignDoctorSchema)',
    );
  }

  const payload: AssignDoctorPayload = {
    organizationId: input.organizationId,
    sender: {
      userId: doctorUserId,
      name: input.doctor?.name,
      email: input.doctor?.email,
      userType: input.doctor?.userType ?? 'STAFF',
      presenceStatus: input.doctor?.presenceStatus,
    },
    receiver: {
      userId: patientUserId,
      name: input.patient?.name,
      email: input.patient?.email,
      profileImage: input.patient?.profileImage,
      userType: input.patient?.userType,
      presenceStatus: input.patient?.presenceStatus,
    },
    isReferred: input.isReferred,
  };

  return payload;
}
