import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import { getScheduleServiceClient } from '../clients/schedule-service.client';
import { getEnvConfig } from '../config/env';
import { RequestContext } from '../context/request-context';
import { BaseService } from '../core/base.service';
import { getAppointmentMapper } from '../mappers/appointment.mapper';
import { Appointment, User } from '../types';
import {
  AppointmentSyncResult,
  FetchSchedulesRequest,
  PendingAppointment,
  Schedule,
  ScheduleCreateRequest,
} from '../types/appointment-sync.types';
import { SSOError } from '../types/errors/sso-error';
import { getAppointmentsService } from './appointments.service'; 

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
    context: RequestContext
  ): Promise<AppointmentSyncResult> {

    const logger = createChildLogger(baseLogger, {
      component: 'AppointmentSyncService',
      correlationId: context.correlationId,
    });

    logger.info({
      event: 'appointment_sync_start',
      doctorId,
    });

    const appointments =
      await this.appointmentsService.getTodaysAppointments(
        doctorId,
        context.correlationId
      );

    const results =
      await this.syncAppointmentsForDoctorWithProvidedAppointmentsInternal(
        doctorId,
        appointments,
        context,
        logger,
        'today'
      );

    logger.info({
      event: 'appointment_sync_complete',
      doctorId,
      ...results,
    });

    return {
      ...results,
      message: 'Appointment sync completed',
      totalAppointments: results.totalAppointments,
      status: results.failed > 0 ? 'PARTIAL' : 'SUCCESS',
    };
  }

  formatSyncResponse(result: AppointmentSyncResult) {
    return {
      success: true,
      data: result,
    };
  }

  async syncAppointmentsForDoctorWithProvidedAppointments(
    doctorId: number,
    appointments: Appointment[],
    context: RequestContext
  ): Promise<AppointmentSyncResult> {

    const logger = createChildLogger(baseLogger, {
      component: 'AppointmentSyncService',
      correlationId: context.correlationId,
    });

    const results =
      await this.syncAppointmentsForDoctorWithProvidedAppointmentsInternal(
        doctorId,
        appointments,
        context,
        logger,
        'provided'
      );

    return {
      ...results,
      message: 'Appointment sync completed',
      totalAppointments: results.totalAppointments,
      status: results.failed > 0 ? 'PARTIAL' : 'SUCCESS',
    };
  }

  private async syncAppointmentsForDoctorWithProvidedAppointmentsInternal(
    doctorId: number,
    appointments: Appointment[],
    context: RequestContext,
    logger: ReturnType<typeof createChildLogger>,
    source: 'today' | 'provided',
  ): Promise<AppointmentSyncResult> {

    logger.info({
      event: 'appointment_sync_start',
      doctorId,
      source,
      appointmentCount: appointments.length,
    });

    const doctorEmail = appointments[0].doctor.email || '';
    const doctorAttributes = await this.cognitoService.findUserByEmail(doctorEmail);
    console.log("doctorAttributes",doctorAttributes);
    if (!doctorAttributes) {
      logger.warn({
        event: 'doctor_not_found',
        doctorId,
      });
      return {
        message: 'Doctor not found',
        totalAppointments: 0,
        status: 'SUCCESS',
        synced: 0,
        skipped: 0,
        failed: 0,
        pending: 0,
      };
    } 

    if (!appointments.length) {
      logger.info({
        event: 'appointment_sync_no_appointments',
        doctorId,
        source,
      });

      return {
        message: 'No appointments found',
        totalAppointments: 0,
        status: 'SUCCESS',
        synced: 0,
        skipped: 0,
        failed: 0,
        pending: 0,
      };
    }
    const doctor = {
      id: doctorAttributes?.doctorUid || context.correlationId || 'default',
      externalId: doctorId,
      provider: 'TruTech',
      tenantId: context.correlationId || 'default',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const results = await this.processAppointments(
      appointments,
      doctor as User,
      context
    );

    logger.info({
      event: 'appointment_sync_complete',
      doctorId,
      source,
      ...results,
    });

    return {
      ...results,
      totalAppointments: appointments.length,
      status: results.failed > 0 ? 'PARTIAL' : 'SUCCESS',
    };
  }

  private async validateDoctor(
    doctorId: number,
    context: RequestContext
  ): Promise<User> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      doctorId,
    });

    const user = await this.ssoUserServiceClient.findByExternalId(
      {
        provider: 'TruTech',
        externalId: String(doctorId),
        tenantId: context.tenantId,
      },
      context
    );

    if (!user) {
      logger.warn({ event: 'doctor_validation_failed', doctorId });

      throw SSOError.invalidRequest(
        `Doctor not found for external doctorId: ${doctorId}`
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
    context: RequestContext
  ): Promise<User | null> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      patientExternalId: appointment.patient.id,
    });

    const user = await this.cognitoService.findUserByEmail(appointment.patient.email || '');

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
      userId: user?.doctorUid,
    });

    return {
      id: user?.doctorUid,
      externalId: String(appointment.patient.id),
      provider: 'TruTech',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tenantId: context.tenantId,
    };
  }

  private async checkDuplicateSchedule(
    appointment: Appointment,
    doctorUser: User,
    patientUser: User,
    context: RequestContext
  ): Promise<boolean> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      appointmentId: appointment.appointmentId,
    });

    const payload: FetchSchedulesRequest = {
      fromDate: new Date(appointment.startTime).getTime(),
      toDate: new Date(appointment.endTime).getTime(),
      organizationID:
        patientUser.organizationId || appointment.patient.organizationId,
    };

    const schedules = await this.scheduleClient.fetchSchedules(
      payload,
      context
    );

    const externalAppointmentId = String(appointment.appointmentId);

    const duplicate = schedules.some((schedule: Schedule) => {

      const hasMatchingMeta =
        schedule.meta?.externalAppointmentId === externalAppointmentId;

      const hasMatchingParticipants =
        schedule.participantInfo?.some(
          (p) => p.userId === String(doctorUser.id) && p.userType === 'STAFF'
        ) &&
        schedule.participantInfo?.some(
          (p) => p.userId === String(patientUser.id) && p.userType === 'USER'
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
    context: RequestContext
  ): Promise<Schedule> {

    return this.retryWithBackoff(() =>
      this.scheduleClient.createSchedule(request, context)
    );
  }

  private async updateScheduleStatusWithRetry(
    scheduleId: string,
    organizationID: string,
    context: RequestContext
  ): Promise<Schedule> {

    return this.retryWithBackoff(() =>
      this.scheduleClient.updateScheduleStatus(
        {
          scheduleId,
          status: 'ACCEPTED',
          organizationID,
        },
        context
      )
    );
  }

  private async processAppointments(
    appointments: Appointment[],
    doctor: User,
    context: RequestContext
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

          const patient = await this.validatePatient(
            appointment,
            context
          );

          if (!patient) {

            this.pendingAppointments.push({
              appointment,
              reason: 'patient_not_found',
              timestamp: new Date().toISOString(),
              retryCount: 0,
              patientExternalId: String(appointment.patient.id),
            });

            pending++;
            details.pending.push(externalAppointmentId);
            continue;
          }

          const isDuplicate =
            await this.checkDuplicateSchedule(
              appointment,
              doctor,
              patient,
              context
            );

          if (isDuplicate) {
            skipped++;
            details.skipped.push(externalAppointmentId);
            continue;
          }

          const scheduleRequest =
            this.appointmentMapper.mapAppointmentToSchedule(
              appointment,
              doctor,
              patient
            );

          const schedule =
            await this.createScheduleWithRetry(
              scheduleRequest,
              context
            );

          await this.updateScheduleStatusWithRetry(
            schedule.scheduleId,
            schedule.organizationID,
            context
          );

          synced++;
          details.synced.push(externalAppointmentId);

        } catch (error) {

          failed++;
          details.failed.push(externalAppointmentId);

          this.logger.error({
            event: 'appointment_process_error',
            appointmentId: appointment.appointmentId,
            err: serializeError(error as Error),
          });
        }
      }
    };

    for (let i = 0; i < this.concurrencyLimit; i++) {
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

  private async retryWithBackoff<T>(
    operation: () => Promise<T>
  ): Promise<T> {

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {

      try {
        return await operation();
      } catch (error) {

        lastError = error as Error;

        if (attempt < this.maxRetries) {

          const delay = Math.min(
            this.initialDelayMs * Math.pow(2, attempt - 1),
            this.maxDelayMs
          );

          await new Promise((resolve) =>
            setTimeout(resolve, delay)
          );
        }
      }
    }

    throw lastError!;
  }

  getPendingAppointmentsByPatient(
    patientExternalId: string
  ): PendingAppointment[] {

    return this.pendingAppointments.filter(
      (p) => p.patientExternalId === patientExternalId
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
    context: RequestContext
  ): Promise<void> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      patientExternalId,
    });

    const pending = this.getPendingAppointmentsByPatient(
      patientExternalId
    );

    if (!pending.length) {
      logger.info({
        event: 'no_pending_appointments',
        patientExternalId,
      });
      return;
    }

    const patient = await this.ssoUserServiceClient.findByExternalId(
      {
        provider: 'TruTech',
        externalId: patientExternalId,
        tenantId: context.tenantId,
      },
      context
    );

    if (!patient) {
      logger.warn({
        event: 'patient_still_not_found',
        patientExternalId,
      });
      return;
    }

    for (const pendingAppt of pending) {

      try {

        const doctor = await this.validateDoctor(
          pendingAppt.appointment.doctor.id,
          context
        );

        const isDuplicate =
          await this.checkDuplicateSchedule(
            pendingAppt.appointment,
            doctor,
            patient,
            context
          );

        if (isDuplicate) {
          this.removePendingAppointment(pendingAppt);
          continue;
        }

        const scheduleRequest =
          this.appointmentMapper.mapAppointmentToSchedule(
            pendingAppt.appointment,
            doctor,
            patient
          );

        const schedule =
          await this.createScheduleWithRetry(
            scheduleRequest,
            context
          );

        await this.updateScheduleStatusWithRetry(
          schedule.scheduleId,
          schedule.organizationID,
          context
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

let appointmentSyncServiceInstance: AppointmentSyncService | null = null;

export function getAppointmentSyncService(): AppointmentSyncService {

  if (!appointmentSyncServiceInstance) {
    appointmentSyncServiceInstance = new AppointmentSyncService();
  }

  return appointmentSyncServiceInstance;
}