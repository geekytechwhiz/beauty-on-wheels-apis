import { buildSchedulerContext } from "../context/context-factory";
import { Appointment } from "../types/appointment.types";
import { getAppointmentSyncService } from "./appointment-sync.service";

 

export const handler = async () => {

  const correlationId = crypto.randomUUID();

  const tenantId = process.env.DEFAULT_ORG_ID as string;

  const context = await buildSchedulerContext(
    tenantId,
    correlationId
  );

  const appointmentSyncService = getAppointmentSyncService();

  const doctorId = 1001;

  const appointments = [
    {
      appointmentId: '123',
      patient: { id: '2001' },
      doctor: { id: 1001 },
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    },
  ];

  await appointmentSyncService.syncAppointmentsForDoctorWithProvidedAppointments(
    doctorId,
    appointments as unknown as Appointment[],
    context
  );

};