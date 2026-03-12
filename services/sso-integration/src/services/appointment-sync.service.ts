/* eslint-disable @typescript-eslint/no-explicit-any */

import { createChildLogger, LogEntry, serializeError } from '@api-hub/logger';
import { BaseService } from '../core/base.service';

import { fromDateString, toDateString } from '@api-hub/utils';

import { getEnvConfig } from '../config/env';
import { getScheduleServiceClient } from '../clients/schedule-service.client';
import { getAppointmentMapper } from '../mappers/appointment.mapper';

import {
  Appointment,
  AppointmentSyncResult,
  FetchSchedulesRequest,
  PendingAppointment,
  SSORequestContext,
  User,
} from '../types';

import { CognitoUserContext } from '../types/user/user.types';

import { CONSTANTS } from '../utils/constants';

import { HmsAppointmentService } from './appointment-sync/hms-appointment.service';
import { AppointmentValidationService } from './appointment-sync/appointment-validation.service';
import { UserProvisioningService } from './appointment-sync/user-provisioning.service';
import { AppointmentIdempotencyService } from './appointment-sync/appointment-idempotency.service';
import { ScheduleConflictService } from './appointment-sync/schedule-conflict.service';
import { ScheduleCreationService } from './appointment-sync/schedule-creation.service';
import { PendingAppointmentService } from './appointment-sync/pending-appointment.service';

export class AppointmentSyncService extends BaseService {
  private readonly scheduleClient = getScheduleServiceClient();
  private readonly appointmentMapper = getAppointmentMapper();

  private readonly pendingAppointments: PendingAppointment[] = [];

  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly concurrencyLimit: number;

  private readonly hmsAppointmentService: HmsAppointmentService;
  private readonly appointmentValidationService: AppointmentValidationService;
  private readonly userProvisioningService: UserProvisioningService;
  private readonly appointmentIdempotencyService: AppointmentIdempotencyService;
  private readonly scheduleConflictService: ScheduleConflictService;
  private readonly scheduleCreationService: ScheduleCreationService;
  private readonly pendingAppointmentService: PendingAppointmentService;

  constructor() {
    super('AppointmentSyncService');

    const env = getEnvConfig();

    this.maxRetries = env.APPOINTMENT_SYNC_MAX_RETRIES;
    this.initialDelayMs = env.APPOINTMENT_SYNC_RETRY_DELAY_MS;
    this.maxDelayMs = env.APPOINTMENT_SYNC_MAX_RETRY_DELAY_MS;
    this.concurrencyLimit = env.APPOINTMENT_SYNC_CONCURRENCY_LIMIT;

    this.hmsAppointmentService = new HmsAppointmentService(
      (this as any).truTechClient,
      (this as any).truTechAdapter,
      this.logger,
    );

    this.appointmentValidationService = new AppointmentValidationService({
      warn: (meta: unknown) => this.logger.warn(meta as LogEntry),
    });

    this.userProvisioningService = new UserProvisioningService(
      (this as any).ssoUserServiceClient,
      this.logger,
    );

    this.appointmentIdempotencyService = new AppointmentIdempotencyService(
      this.scheduleClient,
      this.logger,
    );

    this.scheduleConflictService = new ScheduleConflictService();

    this.scheduleCreationService = new ScheduleCreationService(
      this.scheduleClient,
      this.appointmentMapper,
      this.logger,
      {
        maxRetries: this.maxRetries,
        initialDelayMs: this.initialDelayMs,
        maxDelayMs: this.maxDelayMs,
      },
    );

    this.pendingAppointmentService = new PendingAppointmentService(
      this.pendingAppointments,
      (this as any).cognitoService,
      this.appointmentIdempotencyService,
      this.scheduleCreationService,
      this.logger,
      this.maxRetries,
    );
  }

  async syncAppointments(
    context: SSORequestContext,
  ): Promise<AppointmentSyncResult> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    logger.info({
      event: 'appointment_sync_start',
      tenantId: context.tenantId,
    });

    const fromDate = fromDateString(0);
    const toDate = toDateString(5);

    const appointments =
      await this.hmsAppointmentService.getAppointmentsForDoctorsInRange(
        fromDate,
        toDate,
        context.correlationId,
      );

    if (!appointments.length) {
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

    const results = await this.syncDoctorAppointments(appointments, context);

    logger.info({
      event: 'appointment_sync_complete',
      ...results,
    });

    return results;
  }

  private async syncDoctorAppointments(
    appointments: Appointment[],
    context: SSORequestContext,
  ): Promise<AppointmentSyncResult> {
    const { validAppointments } =
      this.appointmentValidationService.validateAppointments(
        appointments,
        context,
      );

    if (!validAppointments.length) {
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

    const doctor = await this.userProvisioningService.getOrCreateDoctor(
      validAppointments[0],
      context,
    );

    return this.processAppointments(
      validAppointments,
      doctor as unknown as CognitoUserContext,
      context,
    );
  }

  private async processAppointments(
    appointments: Appointment[],
    doctor: CognitoUserContext,
    context: SSORequestContext,
  ): Promise<AppointmentSyncResult> {
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let pending = 0;
    const duplicates = 0;
    let conflicts = 0;

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
          let cognitoUser: CognitoUserContext | null = null;

          /* ---------- FIXED USER LOOKUP ---------- */

          if (appointment.patient.email) {
            try {
              cognitoUser = await this.cognitoService.findCognitoUserByEmail(
                appointment.patient.email,
              );
            } catch (err: any) {
              if (err?.name !== 'ResourceNotFoundException') {
                throw err;
              }
            }
          }

          if (!cognitoUser && appointment.patient.phone) {
            try {
              cognitoUser = await this.cognitoService.findCognitoUserByPhone(
                appointment.patient.phone,
              );
            } catch (err: any) {
              if (err?.name !== 'ResourceNotFoundException') {
                throw err;
              }
            }
          }

          /* ---------- END FIX ---------- */

          if (!cognitoUser) {
            this.pendingAppointmentService.addPendingAppointment({
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

          const scheduleFetchPayload: FetchSchedulesRequest = {
            fromDate: new Date(appointment.startTime).getTime(),
            toDate: new Date(appointment.endTime).getTime(),
            organizationID:
              cognitoUser.organizationId ?? CONSTANTS.ORGANIZATION_ID,
            doctorId: String(doctor.userId),
            userId: String(cognitoUser.userId),
          };

          const existingSchedules = await this.scheduleClient.fetchSchedules(
            scheduleFetchPayload,
            context,
          );

          const hasConflict =
            this.scheduleConflictService.detectScheduleConflict(
              existingSchedules,
              appointment,
            );

          if (hasConflict) {
            skipped++;
            conflicts++;
            details.skipped.push(externalAppointmentId);
            continue;
          }

          await this.scheduleCreationService.createServiceScheduleWithRetry(
            appointment,
            doctor,
            cognitoUser as unknown as User,
            context,
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
      total: appointments.length,
      duplicates,
      conflicts,
      validationFailed: 0,
      details,
    };
  }

  getPendingAppointmentsByPatient(
    patientExternalId: string,
  ): PendingAppointment[] {
    return this.pendingAppointmentService.getPendingAppointmentsByPatient(
      patientExternalId,
    );
  }
}