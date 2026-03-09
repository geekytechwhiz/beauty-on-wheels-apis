// =============================================================================
// User Creation Payload Types
// =============================================================================

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
  userType: 'STAFF';
  organizationID: string;
  externalId: string;
  provider: string;
  subDomain: string;
  tenantId: string;
  role: string;
  source: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
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
  invite: 'phone';
  organizationID: string;
}
