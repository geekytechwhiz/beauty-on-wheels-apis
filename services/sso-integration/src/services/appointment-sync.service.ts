import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import { BaseService } from '../core/base.service';
import { getAppointmentsService } from './appointments.service';
import { getScheduleServiceClient } from '../clients/schedule-service.client';
import { Appointment, User } from '../types';
import {
  AppointmentSyncResult,
  FetchSchedulesRequest,
  PendingAppointment,
  Schedule,
  ScheduleCreateRequest,
} from '../types/appointment-sync.types';
import { getAppointmentMapper } from '../mappers/appointment.mapper';
import { getEnvConfig } from '../config/env';
import { SSOError } from '../types/errors/sso-error';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class AppointmentSyncService extends BaseService {
  private readonly appointmentsService = getAppointmentsService();
  private readonly scheduleClient = getScheduleServiceClient();
  private readonly appointmentMapper = getAppointmentMapper();
  private readonly pendingAppointments: PendingAppointment[] = [];
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly concurrencyLimit: number;

  constructor() {
    super('AppointmentSyncService');

    const env = getEnvConfig();
    this.maxRetries = env.APPOINTMENT_SYNC_MAX_RETRIES;
    this.initialDelayMs = env.APPOINTMENT_SYNC_RETRY_DELAY_MS;
    this.maxDelayMs = env.APPOINTMENT_SYNC_MAX_RETRY_DELAY_MS;
    this.concurrencyLimit = env.APPOINTMENT_SYNC_CONCURRENCY_LIMIT;
  }

  async syncAppointments(
    doctorId: number,
    correlationId: string,
  ): Promise<AppointmentSyncResult> {
    const logger = createChildLogger(baseLogger, {
      component: 'AppointmentSyncService',
      correlationId,
    });

    logger.info({
      event: 'appointment_sync_start',
      doctorId,
    });

    const doctor = await this.validateDoctor(doctorId, correlationId);

    const appointments = await this.appointmentsService.getTodaysAppointments(
      doctorId,
      correlationId,
    );

    if (!appointments.length) {
      logger.info({
        event: 'appointment_sync_no_appointments',
        doctorId,
      });

      return {
        message: 'No appointments found for today',
        totalAppointments: 0,
        status: 'SUCCESS',
        synced: 0,
        skipped: 0,
        failed: 0,
        pending: 0,
      };
    }

    const results = await this.processAppointments(
      appointments,
      doctor,
      correlationId,
    );

    logger.info({
      event: 'appointment_sync_complete',
      doctorId,
      totalAppointments: appointments.length,
      ...results,
    });

    return {
      message: 'Appointment sync completed',
      totalAppointments: appointments.length,
      status: results.failed > 0 ? 'PARTIAL' : 'SUCCESS',
      ...results,
    };
  }

  formatSyncResponse(result: AppointmentSyncResult) {
    return {
      success: true,
      data: result,
    };
  }

  private async validateDoctor(
    doctorId: number,
    correlationId: string,
  ): Promise<User> {
    const logger = createChildLogger(this.logger, { correlationId, doctorId });

    const user = await this.userServiceClient.findByExternalId(
      {
        provider: 'TruTech',
        externalId: String(doctorId),
        tenantId: this.config.defaultOrganizationID,
      },
      correlationId,
    );

    if (!user) {
      logger.warn({
        event: 'doctor_validation_failed',
        doctorId,
      });
      throw SSOError.invalidRequest(
        `Doctor not found for external doctorId: ${doctorId}`,
      );
    }

    logger.info({
      event: 'doctor_validation_success',
      doctorId,
      userId: user.id,
    });

    return user;
  }

  private async validatePatient(
    appointment: Appointment,
    correlationId: string,
  ): Promise<User | null> {
    const logger = createChildLogger(this.logger, {
      correlationId,
      patientExternalId: appointment.patient.id,
    });

    const user = await this.userServiceClient.findByExternalId(
      {
        provider: 'TruTech',
        externalId: String(appointment.patient.id),
        tenantId: this.config.defaultOrganizationID,
      },
      correlationId,
    );

    if (!user) {
      logger.info({
        event: 'patient_not_found',
        patientExternalId: appointment.patient.id,
      });
      return null;
    }

    logger.info({
      event: 'patient_validation_success',
      patientExternalId: appointment.patient.id,
      userId: user.id,
    });

    return user;
  }

  private async checkDuplicateSchedule(
    appointment: Appointment,
    doctorUser: User,
    patientUser: User,
    correlationId: string,
  ): Promise<boolean> {
    const logger = createChildLogger(this.logger, {
      correlationId,
      appointmentId: appointment.appointmentId,
    });

    const fromDate = new Date(appointment.startTime).getTime();
    const toDate = new Date(appointment.endTime).getTime();

    const payload: FetchSchedulesRequest = {
      fromDate,
      toDate,
      organizationID:
        patientUser.organizationId || appointment.patient.organizationId,
    };

    const schedules = await this.scheduleClient.fetchSchedules(
      payload,
      correlationId,
    );

    const externalAppointmentId = String(appointment.appointmentId);

    const duplicate = schedules.some((schedule: Schedule) => {
      const hasMatchingMeta =
        schedule.meta?.externalAppointmentId === externalAppointmentId;

      const hasMatchingParticipants =
        schedule.participantInfo?.some(
          (p) =>
            p.userId === String(doctorUser.id) && p.userType === 'STAFF',
        ) &&
        schedule.participantInfo?.some(
          (p) =>
            p.userId === String(patientUser.id) && p.userType === 'USER',
        );

      return hasMatchingMeta && hasMatchingParticipants;
    });

    logger.info({
      event: 'duplicate_schedule_check',
      appointmentId: appointment.appointmentId,
      duplicate,
    });

    return duplicate;
  }

  private async createScheduleWithRetry(
    request: ScheduleCreateRequest,
    correlationId: string,
  ): Promise<Schedule> {
    return this.retryWithBackoff(() =>
      this.scheduleClient.createSchedule(request, correlationId),
    );
  }

  private async updateScheduleStatusWithRetry(
    scheduleId: string,
    organizationID: string,
    correlationId: string,
  ): Promise<Schedule> {
    return this.retryWithBackoff(() =>
      this.scheduleClient.updateScheduleStatus(
        {
          scheduleId,
          status: 'ACCEPTED',
          organizationID,
        },
        correlationId,
      ),
    );
  }

  private async processAppointments(
    appointments: Appointment[],
    doctor: User,
    correlationId: string,
  ): Promise<AppointmentSyncResult> {
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let pending = 0;

    const details = {
      synced: [] as string[],
      skipped: [] as string[],
      failed: [] as string[],
      pending: [] as string[],
    };

    const queue = [...appointments];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length) {
        const appointment = queue.shift();
        if (!appointment) break;

        const externalAppointmentId = String(appointment.appointmentId);

        try {
          const patient = await this.validatePatient(appointment, correlationId);

          if (!patient) {
            this.pendingAppointments.push({
              appointment,
              reason: 'patient_not_found',
              timestamp: new Date().toISOString(),
              retryCount: 0,
              patientExternalId: String(appointment.patient.id),
            });
            pending += 1;
            details.pending.push(externalAppointmentId);
            continue;
          }

          const isDuplicate = await this.checkDuplicateSchedule(
            appointment,
            doctor,
            patient,
            correlationId,
          );

          if (isDuplicate) {
            skipped += 1;
            details.skipped.push(externalAppointmentId);
            continue;
          }

          const scheduleRequest = this.appointmentMapper.mapAppointmentToSchedule(
            appointment,
            doctor,
            patient,
          );

          const schedule = await this.createScheduleWithRetry(
            scheduleRequest,
            correlationId,
          );

          await this.updateScheduleStatusWithRetry(
            schedule.scheduleId,
            schedule.organizationID,
            correlationId,
          );

          synced += 1;
          details.synced.push(externalAppointmentId);
        } catch (error) {
          failed += 1;
          details.failed.push(externalAppointmentId);

          this.logger.error({
            event: 'appointment_process_error',
            appointmentId: appointment.appointmentId,
            err: serializeError(error as Error),
          });
        }
      }
    };

    for (let i = 0; i < this.concurrencyLimit; i += 1) {
      workers.push(worker());
    }

    await Promise.all(workers);

    return {
      message: 'Appointment sync completed',
      totalAppointments: appointments.length,
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      synced,
      skipped,
      failed,
      pending,
      details,
    };
  }

  private async retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.maxRetries) {
          const delay = Math.min(
            this.initialDelayMs * Math.pow(2, attempt - 1),
            this.maxDelayMs,
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }
}

let appointmentSyncServiceInstance: AppointmentSyncService | null = null;

export function getAppointmentSyncService(): AppointmentSyncService {
  if (!appointmentSyncServiceInstance) {
    appointmentSyncServiceInstance = new AppointmentSyncService();
  }

  return appointmentSyncServiceInstance;
}

