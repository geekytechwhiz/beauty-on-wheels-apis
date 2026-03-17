import { Appointment } from '../domain/appointment.types';

/**
 * Message payload for DoctorProvisionQueue.
 * After doctor is created, the worker re-enqueues the same payload to AppointmentSyncQueue.
 */
export interface DoctorProvisionMessage {
  tenantId: string;
  correlationId: string;
  appointment: Appointment;
}
