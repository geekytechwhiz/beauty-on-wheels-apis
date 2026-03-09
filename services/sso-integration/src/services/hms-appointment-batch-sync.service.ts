import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';

import { Appointment } from '../types';
import { RequestContext } from '../context/request-context';
import { getRegisteredDoctorService } from './registered-doctor.service';
import { getHmsAppointmentsProvider } from './hms-appointments-provider.service';
import { getAppointmentSyncService } from './appointment-sync.service';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export interface BatchSyncSummary {
  startDate: string;
  endDate: string;
  doctorCount: number;
  appointmentsFetched: number;
  doctorsProcessed: number;
}

export class HmsAppointmentBatchSyncService {

  private readonly logger = createChildLogger(baseLogger, {
    component: 'HmsAppointmentBatchSyncService',
  });

  private readonly registeredDoctorService = getRegisteredDoctorService();
  private readonly hmsAppointmentsProvider = getHmsAppointmentsProvider();
  private readonly appointmentSyncService = getAppointmentSyncService();

  async syncAllRegisteredDoctors(
    startDate: string,
    endDate: string,
    context: RequestContext,
  ): Promise<BatchSyncSummary> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    logger.info({
      event: 'hms_batch_sync_start',
      startDate,
      endDate,
    });

    const doctorIds =
      await this.registeredDoctorService.getRegisteredDoctorIds(
        context.correlationId,
      );

    const registeredDoctorSet = new Set(doctorIds);

    if (!doctorIds.length) {
      return {
        startDate,
        endDate,
        doctorCount: 0,
        appointmentsFetched: 0,
        doctorsProcessed: 0,
      };
    }

    let totalAppointments = 0;
    let doctorsProcessed = 0;

    try {

      const appointments =
        await this.hmsAppointmentsProvider.getAppointmentsForDoctorsInRange(
          [],
          startDate,
          endDate,
          context.correlationId,
        );

      totalAppointments = appointments.length;

      const filteredAppointments = appointments.filter((appointment) =>
        registeredDoctorSet.has(appointment.doctor.id),
      );

      const grouped = this.groupAppointmentsByDoctor(filteredAppointments);

      for (const [doctorIdStr, doctorAppointments] of grouped.entries()) {

        const doctorId = Number(doctorIdStr);

        if (!Number.isFinite(doctorId)) {
          continue;
        }

        try {

          const result =
            await this.appointmentSyncService.syncAppointmentsForDoctorWithProvidedAppointments(
              doctorId,
              doctorAppointments,
              context,
            );

          doctorsProcessed++;

          logger.info({
            event: 'doctor_sync_complete',
            doctorId,
            result,
          });

        } catch (error) {

          logger.error({
            event: 'doctor_sync_failed',
            doctorId,
            err: serializeError(error as Error),
          });

        }
      }

    } catch (error) {

      logger.error({
        event: 'hms_batch_sync_error',
        err: serializeError(error as Error),
      });

    }

    return {
      startDate,
      endDate,
      doctorCount: doctorIds.length,
      appointmentsFetched: totalAppointments,
      doctorsProcessed,
    };
  }

  private groupAppointmentsByDoctor(
    appointments: Appointment[],
  ): Map<string, Appointment[]> {

    const map = new Map<string, Appointment[]>();

    for (const appointment of appointments) {

      const key = String(appointment.doctor.id);

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key)!.push(appointment);
    }

    return map;
  }
}

let instance: HmsAppointmentBatchSyncService | null = null;

export function getHmsAppointmentBatchSyncService(): HmsAppointmentBatchSyncService {
  if (!instance) {
    instance = new HmsAppointmentBatchSyncService();
  }
  return instance;
}