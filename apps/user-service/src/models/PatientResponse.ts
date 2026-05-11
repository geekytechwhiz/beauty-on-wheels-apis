import { BaseUserResponse } from './BaseUserResponse';

/**
 * Patient Response Interface
 * Extends BaseUserResponse with patient-specific fields
 */
export interface PatientResponse extends BaseUserResponse {
  // Location (extended)
  state: string;
  country: string;
  
  // Patient-specific fields
  lastAppointment: string | null;
  reporterId: string;
  doctor: string; // reporterName
  patientId: string;
  patientOrgId: string;
  
  // Medical information
  gender: string;
  medicalHistory: Record<string, unknown> | null;
  dateOfBirth: string | null;
  age: string | null;
}
