// =============================================================================
// User Creation Payload Types
// =============================================================================

import { SourceSystem } from "./common/context.types";

/**
 * Doctor creation payload for user service API
 */
export interface DoctorCreationPayload {
  userInfo: {
    name: string;
    namePrefix: string;
    contact: {
      email: string;
      phone?: string;
      phoneCode?: string;
    };
    department?: string;
    specialty: string;
    licenseNumber: string;
    workingHours: {
      monday: { available: boolean; availableHours: Array<{ from: string; to: string }> };
      tuesday: { available: boolean; availableHours: Array<{ from: string; to: string }> };
      wednesday: { available: boolean; availableHours: Array<{ from: string; to: string }> };
      thursday: { available: boolean; availableHours: Array<{ from: string; to: string }> };
      friday: { available: boolean; availableHours: Array<{ from: string; to: string }> };
      saturday: { available: boolean; availableHours: Array<{ from: string; to: string }> };
      sunday: { available: boolean; availableHours: Array<{ from: string; to: string }> };
    };
    slotDurationInMinutes: number;
    bio: string;
  };
  userRole: string[];
  invite: 'phone' | 'email';
  userType: 'STAFF';
  organizationID: string;
 
  role: string;
  source: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  externalIdentity: ExternalIdentity;
  createdDate: number;
  modifiedDate: number;
}

/**
 * Patient creation payload for user service API
 */
export interface PatientCreationPayload {
  userInfo: {
    name: string;
    namePrefix: string;
    contact: {
      email?: string;
      phone?: string;
      phoneCode?: string;
    };
    dateOfBirth?: string;
    gender?: string;
    assignDoctor?: {
      name: string;
      doctorId: string;
    };
    emergencyContact: Record<string, unknown>;
    friendNFamily: Record<string, unknown>;
    medicalHistory: {
      allergies: unknown[];
      chronicDiseases: unknown[];
      symptoms: unknown[];
    };
  };
  userRole: string[];
  userType: 'USER';
  invite: 'phone' | 'email';
  organizationID: string;
    externalIdentity: ExternalIdentity;
  createdDate: number;
  modifiedDate: number;
}
export interface ExternalIdentity { 
  externalUserId: string; // user id from external system
  externalHospitalId?: string; // org id or tenant id
  subdomain: string;  
  sourceSystem: SourceSystem;  
  provider: string;
};

 