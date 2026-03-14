import { createChildLogger, serializeError } from '@api-hub/logger';
import { SSORequestContext } from '../../types/common/context.types';
import { PendingAppointment, User } from '../../types';
import { CognitoUserContext, CreatedUserInfo } from '../../types/user/user.types';
import { AppointmentIdempotencyService } from './appointment-idempotency.service';
import { ScheduleCreationService } from './schedule-creation.service';
import type { IPendingAppointmentStore } from './pending-appointment-store';

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
    private readonly store: IPendingAppointmentStore,
    private readonly cognitoService: CognitoService,
    private readonly appointmentIdempotencyService: AppointmentIdempotencyService,
    private readonly scheduleCreationService: ScheduleCreationService,
    private readonly logger: any,
    private readonly maxRetries: number,
    private readonly userServiceClient?: UserServiceClient,
  ) {}

  async addPendingAppointment(
    tenantId: string,
    pending: PendingAppointment,
  ): Promise<void> {
    this.logger.info({
      event: 'pending_appointment_added',
      correlationId: undefined,
      tenantId,
      externalAppointmentId: pending.externalAppointmentId,
      doctorExternalId: pending.doctorExternalId,
      patientExternalId: pending.patientExternalId,
      doctorUserId: null,
      patientUserId: null,
    });
    await this.store.add(tenantId, pending);
  }

  async getPendingAppointmentsByPatient(
    tenantId: string,
    patientExternalId: string,
  ): Promise<PendingAppointment[]> {
    return this.store.getByPatient(tenantId, patientExternalId);
  }

  async removePendingAppointment(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
  ): Promise<void> {
    await this.store.remove(tenantId, patientExternalId, externalAppointmentId);
  }

  async reprocessPendingAppointments(
    patientExternalId: string,
    context: SSORequestContext,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      patientExternalId,
    });

    const pending = await this.getPendingAppointmentsByPatient(
      context.tenantId,
      patientExternalId,
    );

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
          continue;
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
          await this.removePendingAppointment(
            context.tenantId,
            pendingAppt.patientExternalId,
            pendingAppt.externalAppointmentId,
          );
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

        await this.removePendingAppointment(
          context.tenantId,
          pendingAppt.patientExternalId,
          pendingAppt.externalAppointmentId,
        );
      } catch (error) {
        const newRetryCount = pendingAppt.retryCount + 1;

        if (newRetryCount >= this.maxRetries) {
          await this.removePendingAppointment(
            context.tenantId,
            pendingAppt.patientExternalId,
            pendingAppt.externalAppointmentId,
          );
        } else {
          await this.store.updateRetryCount(
            context.tenantId,
            pendingAppt.patientExternalId,
            pendingAppt.externalAppointmentId,
            newRetryCount,
          );
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
          retryCount: newRetryCount,
          err: serializeError(error as Error),
        });
      }
    }
  }
}
