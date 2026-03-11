import { Appointment } from './appointment.types';

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
  reason: 'patient_not_found' | 'schedule_creation_failed';
  timestamp: string;
  retryCount: number;
  patientExternalId: string;
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
  userId: string;
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
  orgAddonId: string;
  serviceName: string;
  serviceType: string;
  [key: string]: unknown; // Allow for additional fields
}

export interface GetAvailableServicesResponse {
  data?: AvailableService[];
  [key: string]: unknown;
}

export interface RecommendServicesRequest {
  organizationId: string;
  type: 'addon';
  userId: string;
  orgAddonId: string;
  assignedDoctorId: string;
  scheduleBy: string; // timestamp as string
}

export interface RecommendedService {
  userAddonId: string;
  orgAddonId: string;
  [key: string]: unknown; // Allow for additional fields
}

export interface RecommendServicesResponse {
  data?: RecommendedService[];
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
  action: 'createSchedule';
  paymentSchedule: 'INSTANT' | 'LATER';
}

export interface CreateServiceScheduleResponse {
  data?: Schedule;
  [key: string]: unknown;
}

export interface UpdateServiceStatusRequest {
  addonId: string;
  type: 'addon';
  userId: string;
  scheduleStatus: 'confirmed' | 'cancelled' | 'completed';
}

export interface UpdateServiceStatusResponse {
  data?: unknown;
  [key: string]: unknown;
}
