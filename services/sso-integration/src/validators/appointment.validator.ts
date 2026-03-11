import { Appointment } from '../types';

export interface AppointmentValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateHmsAppointment(
  appointment: Appointment,
): AppointmentValidationResult {
  if (!appointment.appointmentId) {
    return { valid: false, reason: 'missing_externalAppointmentId' };
  }

  if (!appointment.doctor?.email) {
    return { valid: false, reason: 'missing_doctor_email' };
  }

  if (!appointment.patient?.id) {
    // patient.externalUserId is the HMS-side identifier; mapped from patient.id
    return { valid: false, reason: 'missing_patient_externalUserId' };
  }

  if (!appointment.startTime) {
    return { valid: false, reason: 'missing_startTime' };
  }

  if (!appointment.endTime) {
    return { valid: false, reason: 'missing_endTime' };
  }

  return { valid: true };
}

