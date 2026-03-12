import { createChildLogger, serializeError } from '@api-hub/logger';
import { SSORequestContext } from '../../types/common/context.types';
import { User } from '../../types';
import {
  PendingAppointment,
} from '../../types';
import { CognitoUserContext } from '../../types/user/user.types';
import { AppointmentIdempotencyService } from './appointment-idempotency.service';
import { ScheduleCreationService } from './schedule-creation.service';

type CognitoService = {
  findUserByEmail: (email: string) => Promise<unknown | null>;
};

export class PendingAppointmentService {
  constructor(
    private readonly pendingAppointments: PendingAppointment[],
    private readonly cognitoService: CognitoService,
    private readonly appointmentIdempotencyService: AppointmentIdempotencyService,
    private readonly scheduleCreationService: ScheduleCreationService,
    private readonly logger: any,
    private readonly maxRetries: number,
  ) {}

  addPendingAppointment(pending: PendingAppointment): void {
    this.pendingAppointments.push(pending);
  }

  getPendingAppointmentsByPatient(
    patientExternalId: string,
  ): PendingAppointment[] {
    return this.pendingAppointments.filter(
      (p) => p.patientExternalId === patientExternalId,
    );
  }

  removePendingAppointment(pending: PendingAppointment): void {
    const index = this.pendingAppointments.indexOf(pending);

    if (index > -1) {
      this.pendingAppointments.splice(index, 1);
    }
  }

  async reprocessPendingAppointments(
    patientExternalId: string,
    context: SSORequestContext,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      patientExternalId,
    });

    const pending = this.getPendingAppointmentsByPatient(patientExternalId);

    if (!pending.length) {
      logger.info({
        event: 'no_pending_appointments',
        patientExternalId,
      });
      return;
    }

    const patientAttributes = await this.cognitoService.findUserByEmail(
      patientExternalId,
    );
    if (!patientAttributes) {
      logger.warn({
        event: 'patient_not_found',
        patientExternalId,
      });
      return;
    }
    const patient = patientAttributes as unknown as User;

    for (const pendingAppt of pending) {
      try {
        const doctor = await this.cognitoService.findUserByEmail(
          pendingAppt.appointment.doctor.email as string,
        );
        if (!doctor) {
          logger.warn({
            event: 'doctor_not_found',
            doctorEmail: pendingAppt.appointment.doctor.email,
          });
          return;
        }

        const isDuplicate = await this.appointmentIdempotencyService.checkDuplicateSchedule(
          pendingAppt.appointment,
          doctor as unknown as CognitoUserContext,
          patient,
          context,
        );

        if (isDuplicate) {
          this.removePendingAppointment(pendingAppt);
          continue;
        }

        await this.scheduleCreationService.createServiceScheduleWithRetry(
          pendingAppt.appointment,
          doctor as CognitoUserContext,
          patient,
          context,
        );

        this.removePendingAppointment(pendingAppt);
      } catch (error) {
        pendingAppt.retryCount++;

        if (pendingAppt.retryCount >= this.maxRetries) {
          this.removePendingAppointment(pendingAppt);
        }

        logger.error({
          event: 'pending_appointment_reprocess_error',
          appointmentId: pendingAppt.appointment.appointmentId,
          err: serializeError(error as Error),
        });
      }
    }
  }
}

