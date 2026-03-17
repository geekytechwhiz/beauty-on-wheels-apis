import {  VisitType } from "../enums" 

    export interface Appointment {
    appointmentId: number
    startTime: string
    endTime: string
    status: AppointmentStatus
    notes?: string | null
  
    patient: Patient
    doctor: Doctor
    consultationType: ConsultationType
    visit: Visit
    integration?: {
      providerId: string;
      subdomain: string;
      externalHospitalId?: string;
    }
  }
  export interface RateLimitState {
    count: number;
    resetAt: number; // Unix timestamp in milliseconds
  }
  export interface Patient {
    id: number;
    mrn: string; 
    name: string;
    gender: string;
    age: string | null; 
    phone?: string | null; 
    email?: string | null; 
    dob: string | null;
  }
    export interface Doctor {
    id: number;
    name: string;
    department: string;
    phone: string;
    email: string;
  } 
  
  export enum AppointmentStatus {
    SCHEDULED = 1,
    CHECKED_IN = 2,
    IN_PROGRESS = 3,
    COMPLETED = 4,
    CANCELLED = 5,
    NO_SHOW = 6
  }
 
  export interface ConsultationType {
    id: number;
    name: string;
  }
  export interface Visit {
    id: number;
    visitType: VisitType;
    createdAt: string;
    status: number;
  }

  export interface Diagnosis {
    code?: string;
    name: string;
    type?: string;
  }
  
  export interface Vital {
    name: string;
    value: string;
    unit?: string;
    recordedAt?: string;
  }
  
  export interface Medicine {
    name: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
    instructions?: string;
  }
  
  export interface Investigation {
    name: string;
    result?: string;
    status?: string;
    date?: string;
  }
  
  export interface Service {
    name: string;
    status?: string;
    date?: string;
  }
  
  export interface Allergy {
    allergen: string;
    reaction?: string;
    severity?: string;
  }
  
  export interface Followup {
    date: string;
    notes?: string;
    doctorId?: number;
  }
  
  export interface ConsultationType {
    id: number;
    name: string;
  } 

export interface AppointmentSyncRequest {
  doctorId: number;
}

export interface AppointmentSyncResult {
  message: string;
  totalAppointments: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  synced: number;
  skipped: number;
  failed: number;
  pending: number;
  total?: number;
  duplicates?: number;
  conflicts?: number;
  validationFailed?: number;
  details?: {
    synced: string[]; // scheduleIds
    skipped: string[]; // externalAppointmentIds
    failed: string[]; // externalAppointmentIds
    pending: string[]; // externalAppointmentIds
  };
}

export interface PendingAppointment {
  appointment: Appointment;
  reason: 'patient_not_found' | 'schedule_creation_failed' | 'user_not_resolved';
  timestamp: string;
  retryCount: number;
  appointmentId?: string;
  tenantId?: string;
  organizationID?: string;
  patientUserId?: string;
  doctorUserId?: string;
  patientExternalId: string;
  doctorExternalId: string;
  externalAppointmentId: string;
}

export interface ScheduleParticipantInfo {
  userId: string;
  userType: 'STAFF' | 'USER';
  organizationID: string;
}

export interface ScheduleMeta {
  externalAppointmentId: string;
  consultationType?: string;
  visitId?: number;
  integration?: {
    providerId: string;
    subdomain: string;
    externalHospitalId?: string;
  };
  sourceSystem?: string;
}

export interface ScheduleCreateRequest {
  startTime: string;
  endTime: string;
  scheduleDate: string;
  appointmentType: 'ONLINE';
  owner: {
    userId: string;
    userType: 'STAFF';
  };
  participantInfo: ScheduleParticipantInfo[];
  organizationID: string;
  externalAppointmentId: string;
  meta?: ScheduleMeta;
}

export interface ScheduleStatusUpdateRequest {
  scheduleId: string;
  status: 'ACCEPTED' | 'CANCELLED' | 'COMPLETED';
  organizationID: string;
}

export interface FetchSchedulesRequest {
  fromDate: number; // timestamp
  toDate: number; // timestamp
  organizationID: string;
  doctorId: string;
  userId?: string;
}

export interface Schedule {
  scheduleId: string;
  startTime: string;
  endTime: string;
  scheduleDate: string;
  appointmentType: string;
  owner: {
    userId: string;
    userType: string;
  };
  participantInfo: ScheduleParticipantInfo[];
  organizationID: string;
  meta?: ScheduleMeta;
}

// Service-based schedule creation types
export interface GetAvailableServicesRequest {
  organizationId: string;
  assignOrgId: string;
  serviceType: 'addon';
  listingType: 'recommended';
  featureKey: 'doctor_consultancy';
  featureCat: 'consultancy';
}

export interface AvailableService {
  addonId: string; // This is the orgAddonId
  orgAddonId: string; // Alias for addonId
  title?: string;
  description?: string;
  featureKey?: string;
  featureCategory?: string;
  charges?: {
    price: number;
    currency: string;
    offerPrice: number;
  };
  [key: string]: unknown; // Allow for additional fields
}

export interface GetAvailableServicesResponse {
  data: {
    items: AvailableService[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RecommendServicesRequest {
  organizationId: string;
  type: 'addon';
  userId: string;
  orgAddonId: string;
  assignedDoctorId: string;
  scheduleBy: string; // timestamp as number
}

export interface RecommendServicesResponse {
  data: {
    userAddonId: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CreateServiceScheduleRequest {
  serviceType: 'addon';
  userAddonId: string;
  userId: string;
  userName: string;
  userEmail: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  staffSpecialty: string;
  startTime: string;
  endTime: string;
  duration: string;
  scheduleDate: string;
  scheduleTimeStamp: string;
  scheduleType: 'ONLINE' | 'OFFLINE';
  location?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  action: 'createSchedule' | 'createSession';
  paymentSchedule: 'INSTANT' | 'LATER'; 
}

export interface ScheduleDetails {
  id: string;
  scheduleId?: string; // Alias for id
  participantInfo: Array<{
    userId: string;
    userType: 'USER' | 'STAFF';
    name?: string;
    email?: string;
    organizationID: string;
    phoneNumber?: string;
    phoneCode?: string;
    profileImage?: string;
    specialty?: string;
  }>;
  owner: {
    userId: string;
    userType: 'STAFF';
    name?: string;
    email?: string;
    profileImage?: string;
    specialty?: string;
    isCaller?: boolean;
  };
  appointmentType: string;
  title?: string;
  description?: string;
  organizationID: string;
  scheduleTimeStamp: string;
  scheduleDate: string;
  startTime: string;
  endTime: string;
  duration: string;
  location?: {
    organizationName?: string;
    organizationID?: string;
    organizationAddress?: {
      country?: string;
      address?: string;
      state?: string;
      city?: string;
      countryCode?: string;
      postalCode?: string;
    };
  };
  pincode?: string;
  latitude?: number;
  longitude?: number;
  phoneNumber?: string;
  phoneCode?: string;
  meta?: {
    userId?: string;
    userAddonId?: string;
    paymentSchedule?: string;
    [key: string]: unknown;
  };
  status?: string;
  bookingId?: string;
  qrCode?: string;
  ticketLink?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CreateServiceScheduleResponse {
  data: {
    scheduleDetails: ScheduleDetails;
    service?: {
      userAddonId: string;
      orgAddonId: string;
      status?: string;
      scheduledStatus?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UpdateServiceStatusRequest {
  addonId: string;
  type: 'addon';
  userId: string;
  organizationId: string;
  scheduleStatus: 'confirmed' | 'cancelled' | 'completed';
  paymentStatus?: 'completed' | 'pending' | 'failed';
}

export interface UpdateServiceStatusResponse {
  data: {
    userAddonId: string;
    orgAddonId?: string;
    scheduledStatus?: string;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Updated FetchSchedulesResponse to match actual API structure
export interface FetchSchedulesResponse {
  data: {
    items: Array<{
      userAddonId: string;
      orgAddonId: string;
      scheduled?: Array<{
        scheduleId: string;
        startTime: string;
        endTime: string;
        scheduleDate: string;
        scheduleTimeStamp: string;
        participantInfo: ScheduleParticipantInfo[];
        owner: {
          userId: string;
          userType: string;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      }>;
      schedule?: ScheduleDetails;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
