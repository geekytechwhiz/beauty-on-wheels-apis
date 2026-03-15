import { Appointment } from '../domain/appointment.types';
import { CreatedUserInfo, User } from '../user/user.types';

export interface ScheduleCreationAppointmentPayload {
  externalId: string;
  startTime: string;
  endTime: string;
  status: string;
}

export interface ScheduleCreationParticipantPayload {
  userId: string;
  externalUserId: string;
  organizationId: string;
}

/**
 * Normalized payload for ScheduleCreationQueue.
 * Downstream workers should consume only this contract.
 */
export interface ScheduleCreationEventPayload {
  tenantId: string;
  correlationId: string;
  appointment: ScheduleCreationAppointmentPayload;
  doctor: ScheduleCreationParticipantPayload;
  patient: ScheduleCreationParticipantPayload;
}

/**
 * Legacy queue payload kept for worker-side compatibility while old
 * ScheduleCreationQueue messages are draining.
 */
export interface LegacyScheduleCreationMessage {
  tenantId: string;
  correlationId: string;
  appointmentExternalId?: string;
  appointment?: Appointment;
  doctor?: CreatedUserInfo | (Partial<CreatedUserInfo> & Record<string, unknown>);
  patientUser?: User | (Partial<User> & Record<string, unknown>);
  userId?: string;
}

export type ScheduleCreationQueueMessage =
  | ScheduleCreationEventPayload
  | LegacyScheduleCreationMessage;
