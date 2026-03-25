export interface TruTechAppointmentMatchPayload {
  externalAppointmentId: string;
  doctorExternalId: string;
  patientExternalId: string;
  startTime: string;
  endTime: string;
}

export interface CancellationReconciliationMessage {
  tenantId: string;
  correlationId: string;
  organizationId: string;
  fromDate: string;
  toDate: string;
  appointments: TruTechAppointmentMatchPayload[];
}

