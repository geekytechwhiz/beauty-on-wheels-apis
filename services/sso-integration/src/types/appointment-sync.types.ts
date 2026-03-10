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

