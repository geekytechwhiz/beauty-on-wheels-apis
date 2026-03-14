/**
 * Message payload for PendingAppointmentReprocessQueue.
 * Worker loads pending appointments for the patient and re-enqueues each to AppointmentSyncQueue.
 */
export interface PendingReprocessMessage {
  tenantId: string;
  patientExternalId: string;
  correlationId: string;
}
