export interface Appointment {
  appointmentId: string;
  externalAppointmentId: string;
  tenantId: string;
  organizationID: string;
  patientUserId: string;
  doctorUserId: string;
  patientExternalId: string;
  doctorExternalId: string;
  startTime: string;
  endTime: string;
  status: string;
  sourceSystem: string;
  createdAt: string;
  updatedAt: string;
  itemType: 'APPOINTMENT';
}
