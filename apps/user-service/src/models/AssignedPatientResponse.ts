import { BaseUserResponse } from './BaseUserResponse';

/**
 * Assigned Patient Response Interface
 * Extends BaseUserResponse with assigned patient-specific fields
 */
export interface AssignedPatientResponse extends BaseUserResponse {
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
