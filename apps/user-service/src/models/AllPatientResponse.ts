import { BaseUserResponse } from './BaseUserResponse';

/**
 * Active Service interface for appointments
 */
export interface ActiveService {
  userId: string;
  userPackageId?: string;
  userAddonId?: string;
  scheduled?: Array<{
    scheduleId?: string;
    meta?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

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
  activeService?: ActiveService[] | null;
}

