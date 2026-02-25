import { BaseUserResponse } from './BaseUserResponse';

/**
 * DoctorPatient Response Interface
 * Represents doctor/staff rows in doctor-patient listing
 * (essentially staff with optional specialty/sk2)
 */
export interface DoctorPatientResponse extends BaseUserResponse {
  sk2?: string; // specialty (stored as sk2 in DynamoDB)
}

