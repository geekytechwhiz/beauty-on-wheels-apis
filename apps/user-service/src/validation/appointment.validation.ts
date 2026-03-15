import { z } from 'zod';

const requiredString = (field: string) => z.string().trim().min(1, `${field} is required`);

export const createAppointmentSchema = z.object({
  appointmentId: requiredString('appointmentId'),
  externalAppointmentId: requiredString('externalAppointmentId'),
  tenantId: requiredString('tenantId'),
  organizationID: requiredString('organizationID'),
  patientUserId: requiredString('patientUserId'),
  doctorUserId: requiredString('doctorUserId'),
  patientExternalId: requiredString('patientExternalId'),
  doctorExternalId: requiredString('doctorExternalId'),
  startTime: requiredString('startTime'),
  endTime: requiredString('endTime'),
  status: requiredString('status'),
  sourceSystem: requiredString('sourceSystem'),
});

export const getAppointmentSchema = z.object({
  patientUserId: requiredString('patientUserId'),
  appointmentId: requiredString('appointmentId'),
});

export const listAppointmentsSchema = z.object({
  patientUserId: requiredString('patientUserId'),
});
