import { BaseUserResponse } from './BaseUserResponse';

/**
 * Lab Patient Response Interface
 * Extends BaseUserResponse with lab patient-specific fields
 */
export interface LabPatientResponse extends BaseUserResponse {
  // Location (extended)
  state: string;
  country: string;
  
  // Patient-specific fields
  lastAppointment: string | null;
  reporterId: string;
  doctor: string;
  patientId: string;
  patientOrgId: string;
  
  // Medical information
  gender: string;
  medicalHistory: Record<string, unknown> | null;
  dateOfBirth: string | null;
}
