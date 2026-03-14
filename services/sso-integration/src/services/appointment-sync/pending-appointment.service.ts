import { createChildLogger, serializeError } from '@api-hub/logger';
import { SSORequestContext } from '../../types/common/context.types';
import { PendingAppointment, User } from '../../types';
import { CognitoUserContext, CreatedUserInfo } from '../../types/user/user.types';
import { AppointmentIdempotencyService } from './appointment-idempotency.service';
import { ScheduleCreationService } from './schedule-creation.service';

type CognitoService = {
  findCognitoUserByEmail: (email: string) => Promise<CognitoUserContext | null>;
};

type UserServiceClient = {
  findUserByExternalId: (
    params: { externalId: string },
    context: SSORequestContext,
  ) => Promise<User | null>;
};

export class PendingAppointmentService {
  constructor(
    private readonly pendingAppointments: PendingAppointment[],
    private readonly cognitoService: CognitoService,
    private readonly appointmentIdempotencyService: AppointmentIdempotencyService,
    private readonly scheduleCreationService: ScheduleCreationService,
    private readonly logger: any,
    private readonly maxRetries: number,
    private readonly userServiceClient?: UserServiceClient,
  ) {}

  addPendingAppointment(pending: PendingAppointment): void {
    this.logger.info({
      event: 'pending_appointment_added',
      correlationId: undefined,
      tenantId: undefined,
      externalAppointmentId: pending.externalAppointmentId,
      doctorExternalId: pending.doctorExternalId,
      patientExternalId: pending.patientExternalId,
      doctorUserId: null,
      patientUserId: null,
    });
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
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        externalAppointmentId: null,
        doctorExternalId: null,
        patientExternalId,
        doctorUserId: null,
        patientUserId: null,
      });
      return;
    }

    // 1️⃣ Resolve patient via user-service by externalId, then fallback to Cognito email/claims if needed
    let patient: User | null = null;

    if (this.userServiceClient) {
      patient = await this.userServiceClient.findUserByExternalId(
        { externalId: patientExternalId },
        context,
      );
    }

    if (!patient) {
      const cognitoPatient =
        await this.cognitoService.findCognitoUserByEmail(
          pending[0].appointment.patient.email as string,
        );

      if (!cognitoPatient) {
        logger.warn({
          event: 'patient_not_found_on_reprocess',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: null,
          doctorExternalId: null,
          patientExternalId,
          doctorUserId: null,
          patientUserId: null,
        });
        return;
      }

      patient = {
        id: Number(cognitoPatient.userId),
      } as unknown as User;
    }

    for (const pendingAppt of pending) {
      try {
        const doctorCognito =
          await this.cognitoService.findCognitoUserByEmail(
            pendingAppt.appointment.doctor.email as string,
          );
        if (!doctorCognito) {
          logger.warn({
            event: 'doctor_not_found_on_reprocess',
            correlationId: context.correlationId,
            tenantId: context.tenantId,
            externalAppointmentId: pendingAppt.externalAppointmentId,
            doctorExternalId: pendingAppt.doctorExternalId,
            patientExternalId,
            doctorUserId: null,
            patientUserId: String(patient.id),
          });
          return;
        }

        const isDuplicate = await this.appointmentIdempotencyService.checkDuplicateSchedule(
          pendingAppt.appointment,
          doctorCognito as unknown as CognitoUserContext,
          patient,
          context,
        );

        if (isDuplicate) {
          logger.info({
            event: 'pending_appointment_duplicate_skipped',
            correlationId: context.correlationId,
            tenantId: context.tenantId,
            externalAppointmentId: pendingAppt.externalAppointmentId,
            doctorExternalId: pendingAppt.doctorExternalId,
            patientExternalId,
            doctorUserId: String(doctorCognito.userId),
            patientUserId: String(patient.id),
          });
          this.removePendingAppointment(pendingAppt);
          continue;
        }

        logger.info({
          event: 'pending_appointment_retry_start',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: pendingAppt.externalAppointmentId,
          doctorExternalId: pendingAppt.doctorExternalId,
          patientExternalId,
          doctorUserId: String(doctorCognito.userId),
          patientUserId: String(patient.id),
        });

        await this.scheduleCreationService.createServiceScheduleWithRetry(
          pendingAppt.appointment,
          doctorCognito as CreatedUserInfo,
          patient,
          context,
        );

        logger.info({
          event: 'pending_appointment_retry_success',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: pendingAppt.externalAppointmentId,
          doctorExternalId: pendingAppt.doctorExternalId,
          patientExternalId,
          doctorUserId: String(doctorCognito.userId),
          patientUserId: String(patient.id),
        });

        this.removePendingAppointment(pendingAppt);
      } catch (error) {
        pendingAppt.retryCount++;

        if (pendingAppt.retryCount >= this.maxRetries) {
          this.removePendingAppointment(pendingAppt);
        }

        logger.error({
          event: 'pending_appointment_reprocess_error',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: pendingAppt.externalAppointmentId,
          doctorExternalId: pendingAppt.doctorExternalId,
          patientExternalId,
          doctorUserId: null,
          patientUserId: String(patient.id),
          appointmentId: pendingAppt.appointment.appointmentId,
          err: serializeError(error as Error),
        });
      }
    }
  }
}

