import { createChildLogger, serializeError } from '@api-hub/observability';
import { SSORequestContext } from '../../types/common/context.types';
import { PendingAppointment, User } from '../../types';
import { CognitoUserContext } from '../../types/user/user.types';
import { ScheduleCreationEventPayload } from '../../types/events/schedule-creation-message.types';
import { AppointmentIdempotencyService } from './appointment-idempotency.service';
import { ScheduleCreationService } from './schedule-creation.service';
import type { ScheduleServiceClient } from '../../clients/schedule-service.client';
import { SSOUserServiceClient } from '../../clients/user-service.client';

type CognitoService = {
  findCognitoUserByEmail: (email: string) => Promise<CognitoUserContext | null>;
};

type UserServiceClient = {
  findUserByExternalId: (
    params: { externalId: string },
    context: SSORequestContext,
  ) => Promise<User | null>;
};

const isPendingAppointmentBypassEnabled = (): boolean =>
  process.env.BYPASS_PENDING_APPOINTMENT === 'true';

export class PendingAppointmentService {
  constructor(
    private readonly scheduleClient: ScheduleServiceClient,
    private readonly cognitoService: CognitoService,
    private readonly appointmentIdempotencyService: AppointmentIdempotencyService,
    private readonly scheduleCreationService: ScheduleCreationService,
    private readonly logger: any,
    private readonly maxRetries: number,
    private readonly userServiceClient?: UserServiceClient,
    private readonly ssoUserServiceClient?: SSOUserServiceClient,
  ) {}

  async addPendingAppointment(
    tenantId: string,
    pending: PendingAppointment,
    context: SSORequestContext,
  ): Promise<void> {
    if (isPendingAppointmentBypassEnabled()) {
      this.logger.info({
        event: 'pending_appointment_storage_bypassed',
        message: 'Pending appointment storage bypassed (testing mode)',
        correlationId: context.correlationId,
        tenantId,
        appointmentExternalId: pending.externalAppointmentId,
        patientExternalId: pending.patientExternalId,
      });
      return;
    }
    this.logger.info({
      event: 'pending_appointment_added',
      correlationId: context.correlationId,
      tenantId,
      externalAppointmentId: pending.externalAppointmentId,
      doctorExternalId: pending.doctorExternalId,
      patientExternalId: pending.patientExternalId,
      doctorUserId: pending.doctorUserId ?? null,
      patientUserId: pending.patientUserId ?? null,
    });
    await this.ssoUserServiceClient?.storePendingAppointment(tenantId, pending, context);
  }

  async getPendingAppointmentsByPatient(
    tenantId: string,
    patientExternalId: string,
    context: SSORequestContext,
  ): Promise<PendingAppointment[]> {
    if (isPendingAppointmentBypassEnabled()) {
      this.logger.info({
        event: 'pending_appointment_retrieve_bypassed',
        message: 'BYPASS_PENDING_APPOINTMENT enabled — skipping pending retrieve',
        correlationId: context.correlationId,
        tenantId,
        patientExternalId,
      });
      return [];
    }
    if (!this.ssoUserServiceClient) {
      throw new Error(
        'SSOUserServiceClient is required to get pending appointments',
      );
    }
    return this.ssoUserServiceClient.getPendingAppointmentsByPatient(
      tenantId,
      patientExternalId,
      context,
    );
  }

  async removePendingAppointment(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
    context: SSORequestContext,
  ): Promise<void> {
    if (isPendingAppointmentBypassEnabled()) {
      this.logger.info({
        event: 'pending_appointment_remove_bypassed',
        message: 'BYPASS_PENDING_APPOINTMENT enabled — skipping pending remove',
        correlationId: context.correlationId,
        tenantId,
        appointmentExternalId: externalAppointmentId,
        patientExternalId,
      });
      return;
    }
    await this.scheduleClient.removePendingAppointment(
      tenantId,
      patientExternalId,
      externalAppointmentId,
      context,
    );
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
      context,
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
            context,
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

        const normalizedEventPayload: ScheduleCreationEventPayload = {
          tenantId: context.tenantId,
          correlationId: context.correlationId,
          appointment: {
            externalId: pendingAppt.externalAppointmentId,
            startTime: pendingAppt.appointment.startTime,
            endTime: pendingAppt.appointment.endTime,
            status: String(pendingAppt.appointment.status),
          },
          doctor: {
            userId: String(doctorCognito.userId),
            externalUserId:
              pendingAppt.doctorExternalId ||
              String(pendingAppt.appointment.doctor.id),
            organizationId:
              doctorCognito.organizationId ??
              patient.organizationId ??
              context.integration?.subdomain ??
              '',
          },
          patient: {
            userId: String(patient.id),
            externalUserId: pendingAppt.patientExternalId,
            organizationId:
              patient.organizationId ??
              doctorCognito.organizationId ??
              context.integration?.subdomain ??
              '',
          },
        };

        await this.scheduleCreationService.createServiceScheduleWithRetry(
          normalizedEventPayload,
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
          context,
        );
      } catch (error) {
        const newRetryCount = pendingAppt.retryCount + 1;

        if (newRetryCount >= this.maxRetries) {
          await this.removePendingAppointment(
            context.tenantId,
            pendingAppt.patientExternalId,
            pendingAppt.externalAppointmentId,
            context,
          );
        } else {
          await this.scheduleClient.updatePendingAppointmentRetryCount(
            context.tenantId,
            pendingAppt.patientExternalId,
            pendingAppt.externalAppointmentId,
            newRetryCount,
            context,
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
