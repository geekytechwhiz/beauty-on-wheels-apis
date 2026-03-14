import { Appointment } from '../domain/appointment.types';
import { CreatedUserInfo, User } from '../user/user.types';

/**
 * Message payload for ScheduleCreationQueue.
 * Worker uses appointmentExternalId for idempotency.
 */
export interface ScheduleCreationMessage {
  tenantId: string;
  correlationId: string;
  appointmentExternalId: string;
  appointment: Appointment;
  doctor: CreatedUserInfo;
  patientUser: User;
}
