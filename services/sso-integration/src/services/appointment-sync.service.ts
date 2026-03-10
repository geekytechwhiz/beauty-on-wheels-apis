import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import { getScheduleServiceClient } from '../clients/schedule-service.client';
import { getEnvConfig } from '../config/env';
import { RequestContext } from '../context/request-context';
import { BaseService } from '../core/base.service';
import { getAppointmentMapper } from '../mappers/appointment.mapper';
import { Appointment, User } from '../types';
import { DoctorCreationPayload } from '../types/user-creation.types';
import {
  AppointmentSyncResult,
  FetchSchedulesRequest,
  PendingAppointment,
  Schedule,
  ScheduleCreateRequest,
} from '../types/appointment-sync.types';
import { getAppointmentsService } from './appointments.service'; 
import { validateHmsAppointment } from '../validators/appointment.validator';

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
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      integrationProviderId: context.integration?.providerId,
      integrationSubdomain: context.integration?.subdomain,
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
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      integrationProviderId: context.integration?.providerId,
      integrationSubdomain: context.integration?.subdomain,
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
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      integrationProviderId: context.integration?.providerId,
      integrationSubdomain: context.integration?.subdomain,
    });

    const validAppointments: Appointment[] = [];
    const invalidAppointments: { appointmentId: string | number | undefined; reason: string }[] = [];

    for (const appointment of appointments) {
      const result = validateHmsAppointment(appointment);
      if (!result.valid) {
        invalidAppointments.push({
          appointmentId: appointment.appointmentId,
          reason: result.reason ?? 'invalid_appointment',
        });
        this.logger.warn({
          event: 'appointment_validation_failed',
          appointmentId: appointment.appointmentId,
          reason: result.reason,
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          integrationProviderId: context.integration?.providerId,
          integrationSubdomain: context.integration?.subdomain,
        });
        continue;
      }
      validAppointments.push(appointment);
    }

    if (!validAppointments.length) {
      logger.info({
        event: 'appointment_sync_no_valid_appointments',
        doctorId,
        source,
        invalidCount: invalidAppointments.length,
      });

      return {
        message: 'No valid appointments found',
        totalAppointments: 0,
        status: 'SUCCESS',
        synced: 0,
        skipped: 0,
        failed: 0,
        pending: 0,
      };
    }

    const doctorEmail = validAppointments[0].doctor.email || '';
    const doctorAttributes = await this.cognitoService.findUserByEmail(doctorEmail);
    console.log("doctorAttributes",doctorAttributes);
    if (!doctorAttributes) {
      logger.warn({
        event: 'doctor_not_found',
        doctorId,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        integrationProviderId: context.integration?.providerId,
        integrationSubdomain: context.integration?.subdomain,
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

    if (!validAppointments.length) {
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
      validAppointments,
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
      totalAppointments: validAppointments.length,
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

    const existingUser = await this.ssoUserServiceClient.findByExternalId(
      {
        provider: 'TruTech',
        externalId: String(doctorId),
        tenantId: context.tenantId,
      },
      context
    );

    if (!existingUser) {
      logger.warn({ event: 'doctor_not_found_user_service', doctorId });

      const createdOrExisting = await this.ssoUserServiceClient.findOrCreateUserFromExternalIdentity(
        {
          integration: context.integration,
          externalUserId: String(doctorId),
          tenantId: context.tenantId,
          email: undefined,
          createUser: async () =>
            this.ssoUserServiceClient.createUser(
              {
                externalId: String(doctorId),
                provider: 'TruTech',
                tenantId: context.tenantId,
                role: 'DOCTOR',
                source: 'HMS',
                email: '',
                phone: '',
                firstName: '',
                lastName: '',
              } as unknown as DoctorCreationPayload,
              context
            ),
        },
        context
      );

      logger.info({
        event: 'doctor_provisioned_from_external_identity',
        doctorId,
        userId: createdOrExisting.id,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        integrationProviderId: context.integration?.providerId,
        integrationSubdomain: context.integration?.subdomain,
      });

      return createdOrExisting;
    }

    logger.info({
      event: 'doctor_validation_success',
      doctorId,
      userId: existingUser.id,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      integrationProviderId: context.integration?.providerId,
      integrationSubdomain: context.integration?.subdomain,
    });

    return existingUser;
  }

  private async validatePatient(
    appointment: Appointment,
    context: RequestContext
  ): Promise<User | null> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      patientExternalId: appointment.patient.id,
    });

    const externalUserId = String(appointment.patient.id);
    const email = appointment.patient.email || '';

    const existingUser = await this.ssoUserServiceClient.findByExternalId(
      {
        provider: 'TruTech',
        externalId: externalUserId,
        tenantId: context.tenantId,
      },
      context
    );

    if (!existingUser) {
      logger.info({
        event: 'patient_not_found_user_service',
        patientExternalId: externalUserId,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        integrationProviderId: context.integration?.providerId,
        integrationSubdomain: context.integration?.subdomain,
      });

      const createdOrExisting = await this.ssoUserServiceClient.findOrCreateUserFromExternalIdentity(
        {
          integration: context.integration,
          externalUserId,
          tenantId: context.tenantId,
          email,
          createUser: async () =>
            this.ssoUserServiceClient.createPatient(
              {
                userInfo: {
                  name: appointment.patient.name || '',
                  namePrefix: '',
                  contact: {
                    email,
                  },
                  emergencyContact: {},
                  friendNFamily: {},
                  medicalHistory: {
                    allergies: [],
                    chronicDiseases: [],
                    symptoms: [],
                  },
                },
                userRole: [],
                userType: 'USER',
                invite: 'phone',
                organizationID:
                  appointment.patient.organizationId || '',
              },
              externalUserId,
              'TruTech',
              context.tenantId,
              context
            ),
        },
        context
      );

      logger.info({
        event: 'patient_provisioned_from_external_identity',
        patientExternalId: externalUserId,
        userId: createdOrExisting.id,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        integrationProviderId: context.integration?.providerId,
        integrationSubdomain: context.integration?.subdomain,
      });

      return createdOrExisting;
    }

    logger.info({
      event: 'patient_validation_success',
      patientExternalId: externalUserId,
      userId: existingUser.id,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      integrationProviderId: context.integration?.providerId,
      integrationSubdomain: context.integration?.subdomain,
    });

    return existingUser;
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

    const duplicate = await this.checkAppointmentIdempotency(
      appointment,
      doctorUser,
      patientUser,
      context,
    );

    logger.info({
      event: 'duplicate_schedule_check',
      appointmentId: appointment.appointmentId,
      duplicate,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      integrationProviderId: context.integration?.providerId,
      integrationSubdomain: context.integration?.subdomain,
      externalAppointmentId: String(appointment.appointmentId),
    });

    return duplicate;
  }

  private async checkAppointmentIdempotency(
    appointment: Appointment,
    doctorUser: User,
    patientUser: User,
    context: RequestContext,
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

    const schedules = await this.scheduleClient.fetchSchedules(payload, context);

    const externalAppointmentId = String(appointment.appointmentId);

    const hasDuplicate = schedules.some((schedule: Schedule) => {
      const hasMatchingMeta =
        schedule.meta?.externalAppointmentId === externalAppointmentId;

      const hasMatchingParticipants =
        schedule.participantInfo?.some(
          (p) => p.userId === String(doctorUser.id) && p.userType === 'STAFF',
        ) &&
        schedule.participantInfo?.some(
          (p) => p.userId === String(patientUser.id) && p.userType === 'USER',
        );

      return hasMatchingMeta && hasMatchingParticipants;
    });

    if (hasDuplicate) {
      logger.info({
        event: 'appointment_duplicate_detected',
        appointmentId: appointment.appointmentId,
        externalAppointmentId,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        integrationProviderId: context.integration?.providerId,
        integrationSubdomain: context.integration?.subdomain,
      });
    }

    return hasDuplicate;
  }

  private detectScheduleConflict(
    existingSchedules: Schedule[],
    appointment: Appointment,
  ): boolean {
    const appointmentStart = new Date(appointment.startTime).getTime();
    const appointmentEnd = new Date(appointment.endTime).getTime();

    return existingSchedules.some((existing) => {
      const existingStart = new Date(existing.startTime).getTime();
      const existingEnd = new Date(existing.endTime).getTime();

      return appointmentStart < existingEnd && appointmentEnd > existingStart;
    });
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
    let duplicates = 0;
    let conflicts = 0;
    const validationFailed = 0;

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
            duplicates++;
            details.skipped.push(externalAppointmentId);
            continue;
          }

          const orgId =
            patient.organizationId || appointment.patient.organizationId;

          const scheduleFetchPayload: FetchSchedulesRequest = {
            fromDate: new Date(appointment.startTime).getTime(),
            toDate: new Date(appointment.endTime).getTime(),
            organizationID: orgId,
          };

          const existingSchedules = await this.scheduleClient.fetchSchedules(
            scheduleFetchPayload,
            context
          );

          const hasConflict = this.detectScheduleConflict(
            existingSchedules,
            appointment,
          );

          if (hasConflict) {
            skipped++;
            conflicts++;
            details.skipped.push(externalAppointmentId);
            this.logger.info({
              event: 'appointment_schedule_conflict',
              appointmentId: appointment.appointmentId,
              correlationId: context.correlationId,
              tenantId: context.tenantId,
              integrationProviderId: context.integration?.providerId,
              integrationSubdomain: context.integration?.subdomain,
              externalAppointmentId,
            });
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
          this.logger.info({
            event: 'appointment_schedule_created',
            appointmentId: appointment.appointmentId,
            scheduleId: schedule.scheduleId,
            correlationId: context.correlationId,
            tenantId: context.tenantId,
            integrationProviderId: context.integration?.providerId,
            integrationSubdomain: context.integration?.subdomain,
            externalAppointmentId,
          });

        } catch (error) {

          failed++;
          details.failed.push(externalAppointmentId);

          this.logger.error({
            event: 'appointment_process_error',
            appointmentId: appointment.appointmentId,
            correlationId: context.correlationId,
            tenantId: context.tenantId,
            integrationProviderId: context.integration?.providerId,
            integrationSubdomain: context.integration?.subdomain,
            externalAppointmentId,
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
      total: appointments.length,
      duplicates,
      conflicts,
      validationFailed,
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

    if (lastError) {
      throw lastError;
    }

    throw new Error('Operation failed after maximum retries');
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

    const  patientAttributes  = await this.cognitoService.findUserByEmail(patientExternalId);
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