import { BaseUserResponse } from './BaseUserResponse';

/**
 * All-patient Response Interface
 * Shape used by the \"all-patient\" filter in listDoctorPatients.
 * Based on sample payload from the organization user list.
 */
export interface AllPatientResponse extends BaseUserResponse {
  deleteFlag: unknown | null;
  reporterProfilePic: string;
  reporterName: string;
  doctorName: string;
}

