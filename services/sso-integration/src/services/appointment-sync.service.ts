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

import { CreatedUserInfo } from '../types/user/user.types';
import { ScheduleCreationEventPayload } from '../types/events/schedule-creation-message.types';

import { loadTenantDetails } from '../utils/helper';

import { HmsAppointmentService } from './appointment-sync/hms-appointment.service';
import { AppointmentValidationService } from './appointment-sync/appointment-validation.service';
import { UserProvisioningService } from './appointment-sync/user-provisioning.service';
import { AppointmentIdempotencyService } from './appointment-sync/appointment-idempotency.service';
import { ScheduleConflictService } from './appointment-sync/schedule-conflict.service';
import { ScheduleCreationService } from './appointment-sync/schedule-creation.service';
import { PendingAppointmentService } from './appointment-sync/pending-appointment.service';
import { publishScheduleCreation } from './appointment-sync/schedule-creation-queue.service';
import { publishDoctorProvision } from './appointment-sync/doctor-provision-queue.service';

export class AppointmentSyncService extends BaseService {
  private readonly scheduleClient = getScheduleServiceClient();
  private readonly appointmentMapper = getAppointmentMapper();

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
      this.scheduleClient,
      (this as any).cognitoService,
      this.appointmentIdempotencyService,
      this.scheduleCreationService,
      this.logger,
      this.maxRetries,
      (this as any).ssoUserServiceClient,
    );
  }

  private buildLogContext(params: {
    context: SSORequestContext;
    externalAppointmentId?: string;
    doctorExternalId?: string;
    patientExternalId?: string;
    doctorUserId?: string;
    patientUserId?: string;
  }) {
    const {
      context,
      externalAppointmentId,
      doctorExternalId,
      patientExternalId,
      doctorUserId,
      patientUserId,
    } = params;

    return {
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      externalAppointmentId: externalAppointmentId ?? null,
      doctorExternalId: doctorExternalId ?? null,
      patientExternalId: patientExternalId ?? null,
      doctorUserId: doctorUserId ?? null,
      patientUserId: patientUserId ?? null,
    };
  }

  private buildScheduleCreationEventPayload(params: {
    appointment: Appointment;
    doctor: CreatedUserInfo;
    patientUser: User;
    patientOrganizationId: string;
    context: SSORequestContext;
  }): ScheduleCreationEventPayload {
    const { appointment, doctor, patientUser, patientOrganizationId, context } = params;
    const subdomain = context.integration?.subdomain ?? '';
    const normalizedOrganizationId =
      patientOrganizationId ||
      doctor.organizationId ||
      patientUser.organizationId ||
      loadTenantDetails(subdomain).organizationId;

    return {
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      appointment: {
        externalId: String(appointment.appointmentId),
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: String(appointment.status),
      },
      doctor: {
        userId: String(doctor.userId),
        externalUserId:
          doctor.externalUserId || String(appointment.doctor.id),
        organizationId: normalizedOrganizationId,
        name: appointment.doctor.name  ,
        email: doctor.email || undefined,
      },
      patient: {
        userId: String(patientUser.id),
        externalUserId: String(appointment.patient.id),
        organizationId: normalizedOrganizationId,
        name: appointment.patient.name || undefined,
        email: patientUser.email || undefined,
      },
    };
  }

  private mapUserToCreatedUserInfo(
    user: User,
    fallbackExternalUserId: string,
    fallbackOrganizationId: string,
  ): CreatedUserInfo {
    return {
      userId: String(user.id),
      email: user.email ?? null,
      externalUserId:
        String(user.externalId ?? '') || fallbackExternalUserId,
      organizationId: user.organizationId ?? fallbackOrganizationId,
    };
  }

  private async resolvePatientUser(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<User | null> {
    const patientExternalId = String(appointment.patient.id);
    const patient = await this.ssoUserServiceClient.findUserByExternalId(
      { externalId: patientExternalId },
      context,
    );

    if (!patient?.id) {
      return null;
    }

    return patient;
  }

  private async resolveDoctorUser(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo | null> {
    const doctorExternalId = String(appointment.doctor.id);
    const user = await this.ssoUserServiceClient.findUserByExternalId(
      { externalId: doctorExternalId },
      context,
    );

    if (!user?.id) {
      return null;
    }

    const subdomain = context.integration?.subdomain ?? '';

    return this.mapUserToCreatedUserInfo(
      user,
      doctorExternalId,
      user.organizationId ?? loadTenantDetails(subdomain).organizationId,
    );
  }

  private async enqueuePendingAppointment(
    appointment: Appointment,
    reason: PendingAppointment['reason'],
    context: SSORequestContext,
  ): Promise<void> {
    await this.pendingAppointmentService.addPendingAppointment(
      context.tenantId,
      {
        appointment,
        reason,
        timestamp: new Date().toISOString(),
        retryCount: 0,
        patientExternalId: String(appointment.patient.id),
        doctorExternalId: String(appointment.doctor.id),
        externalAppointmentId: String(appointment.appointmentId),
      },
      context,
    );
  }

  /**
   * Fetches appointments from HMS and returns only validated appointments.
   * Used by sync handler when enqueueing to AppointmentSyncQueue (no inline processing).
   */
  async fetchAndValidateAppointments(
    context: SSORequestContext,
    dateRange?: { fromDate?: string; toDate?: string },
  ): Promise<Appointment[]> {
    const fromDate = dateRange?.fromDate ?? fromDateString(0);
    const toDate = dateRange?.toDate ?? toDateString(5);

    const appointments =
      await this.hmsAppointmentService.getAppointmentsForDoctorsInRange(
        fromDate,
        toDate,
        context.correlationId,
        context.tenantId,
      );

    if (!appointments.length) {
      return [];
    }
    console.log("appointments received", JSON.stringify(appointments))
    const { validAppointments } =
      this.appointmentValidationService.validateAppointments(
        appointments,
        context,
      );

    return validAppointments;
  }

  async syncAppointments(
    context: SSORequestContext,
    dateRange?: { fromDate?: string; toDate?: string },
    appointmentsInput?: Appointment[],
  ): Promise<AppointmentSyncResult> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    logger.info({
      event: 'appointment_sync_start',
      tenantId: context.tenantId,
      fromDate: dateRange?.fromDate,
      toDate: dateRange?.toDate,
    });

    const fromDate = dateRange?.fromDate ?? fromDateString(0);
    const toDate = dateRange?.toDate ?? toDateString(5);
    let appointments: Appointment[] = [];

    if(!appointmentsInput || !appointmentsInput.length) {
     appointments =
      await this.hmsAppointmentService.getAppointmentsForDoctorsInRange(
        fromDate,
        toDate,
        context.correlationId,
        context.tenantId,
      );
    } else {
      appointments = appointmentsInput;
    }

     

    const results = await this.syncDoctorAppointments(appointments, context);

    logger.info({
      event: 'appointment_sync_complete',
      ...results,
    });

    return results;
  }

  /**
   * Check if doctor exists (lookup only). Used by appointmentProcessor to decide
   * whether to enqueue to DoctorProvisionQueue or continue processing.
   */
  async getDoctorIfExists(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo | null> {
    return this.userProvisioningService.getDoctorIfExists(appointment, context);
  }

  /**
   * Process a single appointment (used by appointmentProcessor Lambda).
   * Reuses same logic as processAppointments for one item. Throws on error so SQS can retry.
   */
  async processSingleAppointment(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<AppointmentSyncResult> {
    this.logger.info({
      event: 'doctor_provisioning_start',
      ...this.buildLogContext({
        context,
        externalAppointmentId: String(appointment.appointmentId),
        doctorExternalId: String(appointment.doctor.id),
      }),
    });

    const doctor: CreatedUserInfo =
      await this.userProvisioningService.getOrCreateDoctor(
        appointment,
        context,
      );

    this.logger.info({
      event: 'doctor_provisioning_complete',
      ...this.buildLogContext({
        context,
        externalAppointmentId: String(appointment.appointmentId),
        doctorExternalId: String(appointment.doctor.id),
        doctorUserId: doctor.userId,
      }),
    });

    const outcome = await this.processOneAppointment(
      appointment,
      doctor,
      context,
    );

    const externalId = String(appointment.appointmentId);
    switch (outcome) {
      case 'synced':
        return {
          message: 'Appointment processed',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 1,
          skipped: 0,
          failed: 0,
          pending: 0,
          details: { synced: [externalId], skipped: [], failed: [], pending: [] },
        };
      case 'skipped':
        return {
          message: 'Appointment skipped (conflict)',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 0,
          skipped: 1,
          failed: 0,
          pending: 0,
          details: { synced: [], skipped: [externalId], failed: [], pending: [] },
        };
      case 'pending':
        return {
          message: 'Appointment pending (patient not found)',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 0,
          skipped: 0,
          failed: 0,
          pending: 1,
          details: { synced: [], skipped: [], failed: [], pending: [externalId] },
        };
      default:
        return {
          message: 'Appointment processed',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 0,
          skipped: 0,
          failed: 0,
          pending: 0,
          details: { synced: [], skipped: [], failed: [], pending: [] },
        };
    }
  }

  /**
   * Process one appointment when doctor is already known (e.g. after DoctorProvisionWorker).
   * Used by appointmentProcessor when doctor exists; avoids duplicate getOrCreateDoctor.
   */
  async processSingleAppointmentWithDoctor(
    appointment: Appointment,
    doctor: CreatedUserInfo,
    context: SSORequestContext,
  ): Promise<AppointmentSyncResult> {
    const outcome = await this.processOneAppointment(
      appointment,
      doctor,
      context,
    );
    const externalId = String(appointment.appointmentId);
    switch (outcome) {
      case 'synced':
        return {
          message: 'Appointment processed',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 1,
          skipped: 0,
          failed: 0,
          pending: 0,
          details: { synced: [externalId], skipped: [], failed: [], pending: [] },
        };
      case 'skipped':
        return {
          message: 'Appointment skipped (conflict)',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 0,
          skipped: 1,
          failed: 0,
          pending: 0,
          details: { synced: [], skipped: [externalId], failed: [], pending: [] },
        };
      case 'pending':
        return {
          message: 'Appointment pending (patient not found)',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 0,
          skipped: 0,
          failed: 0,
          pending: 1,
          details: { synced: [], skipped: [], failed: [], pending: [externalId] },
        };
      default:
        return {
          message: 'Appointment processed',
          totalAppointments: 1,
          status: 'SUCCESS',
          synced: 0,
          skipped: 0,
          failed: 0,
          pending: 0,
          details: { synced: [], skipped: [], failed: [], pending: [] },
        };
    }
  }

  async reprocessPendingAppointmentsForPatient(
    patientExternalId: string,
    context: SSORequestContext,
  ): Promise<void> {
    await this.pendingAppointmentService.reprocessPendingAppointments(
      patientExternalId,
      context,
    );
  }

  /**
   * Process one appointment given doctor. Returns outcome or throws on error.
   * Shared by processAppointments (batch) and processSingleAppointment (queue consumer).
   */
  private async processOneAppointment(
    appointment: Appointment,
    doctor: CreatedUserInfo,
    context: SSORequestContext,
  ): Promise<'synced' | 'skipped' | 'pending'> {
    const externalAppointmentId = String(appointment.appointmentId);
    const patientExternalId = String(appointment.patient.id);
    const doctorExternalId = String(appointment.doctor.id);

    this.logger.info({
      event: 'user_resolution_start',
      ...this.buildLogContext({
        context,
        externalAppointmentId,
        patientExternalId,
        doctorExternalId,
      }),
    });

    const [resolvedPatient, resolvedDoctor] = await Promise.all([
      this.resolvePatientUser(appointment, context),
      this.resolveDoctorUser(appointment, context),
    ]);

    if (resolvedPatient) {
      this.logger.info({
        event: 'patient_found_in_user_service',
        ...this.buildLogContext({
          context,
          externalAppointmentId,
          patientExternalId,
          doctorExternalId,
          patientUserId: String(resolvedPatient.id),
        }),
      });
    }

    if (resolvedDoctor) {
      this.logger.info({
        event: 'doctor_found_in_user_service',
        ...this.buildLogContext({
          context,
          externalAppointmentId,
          patientExternalId,
          doctorExternalId,
          doctorUserId: resolvedDoctor.userId,
        }),
      });
    }

    if (!resolvedPatient?.id || !resolvedDoctor?.userId) {
      this.logger.warn({
        event: 'external_user_not_resolved',
        tenantId: context.tenantId,
        patientExternalId,
        doctorExternalId,
      });

      const subdomain = context.integration?.subdomain ?? '';
      const organizationId =
        resolvedDoctor?.organizationId ??
        doctor.organizationId ??
        loadTenantDetails(subdomain).organizationId;

      if (!resolvedDoctor?.userId) {
        try {
          await publishDoctorProvision({
            tenantId: context.tenantId,
            correlationId: context.correlationId,
            appointment,
          });
          this.logger.info({
            event: 'doctor_provision_event_triggered_from_sync',
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
            }),
          });
        } catch (err) {
          this.logger.error({
            event: 'doctor_provision_event_publish_failed_from_sync',
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
            }),
            err: serializeError(err as Error),
          });
        }
      }

      if (!resolvedPatient?.id) {
        try {
          const provider = context.integration?.providerId ?? 'TruTech';
          const patientEvent = this.patientEventPublisher.createPatientCreationEvent(
            appointment.patient,
            resolvedDoctor?.userId ?? doctor.userId ?? '',
            organizationId,
            provider,
            context,
          );
          await this.patientEventPublisher.publishPatientCreationEvent(
            patientEvent,
            context.correlationId,
          );
          this.logger.info({
            event: 'patient_creation_event_triggered_from_sync',
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
              doctorUserId: resolvedDoctor?.userId ?? doctor.userId,
            }),
            organizationId,
          });
        } catch (err) {
          this.logger.error({
            event: 'patient_creation_event_publish_failed_from_sync',
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
              doctorUserId: resolvedDoctor?.userId ?? doctor.userId,
            }),
            err: serializeError(err as Error),
          });
        }
      }

      this.logger.info({
        event: 'pending_appointment_create',
        ...this.buildLogContext({
          context,
          externalAppointmentId,
          patientExternalId,
          doctorExternalId,
          doctorUserId: resolvedDoctor?.userId,
          patientUserId: resolvedPatient ? String(resolvedPatient.id) : undefined,
        }),
      });

      await this.enqueuePendingAppointment(
        appointment,
        'user_not_resolved',
        context,
      );

      return 'pending';
    }

    const subdomain = context.integration?.subdomain ?? '';
    const organizationId =
      resolvedPatient.organizationId ??
      resolvedDoctor.organizationId ??
      loadTenantDetails(subdomain).organizationId;
    const doctorUserId = String(resolvedDoctor.userId);
    const patientUserId = String(resolvedPatient.id);

    const scheduleFetchPayload: FetchSchedulesRequest = {
      fromDate: new Date(appointment.startTime).getTime(),
      toDate: new Date(appointment.endTime).getTime(),
      organizationID: organizationId,
      doctorId: doctorUserId,
      userId: patientUserId,
    };

    this.logger.info({
      event: 'schedule_fetch_start',
      ...this.buildLogContext({
        context,
        externalAppointmentId,
        patientExternalId,
        doctorExternalId,
        doctorUserId,
        patientUserId,
      }),
      organizationId,
      payload: scheduleFetchPayload,
    });

    const existingSchedules = await this.scheduleClient.fetchSchedules(
      scheduleFetchPayload,
      context,
    );

    this.logger.info({
      event: 'schedule_fetch_complete',
      ...this.buildLogContext({
        context,
        externalAppointmentId,
        patientExternalId,
        doctorExternalId,
        doctorUserId,
        patientUserId,
      }),
      organizationId,
      scheduleCount: existingSchedules.length,
    });

    const hasConflict =
      this.scheduleConflictService.detectScheduleConflict(
        existingSchedules,
        appointment,
      );

    this.logger.info({
      event: 'schedule_conflict_check',
      ...this.buildLogContext({
        context,
        externalAppointmentId,
        patientExternalId,
        doctorExternalId,
        doctorUserId,
        patientUserId,
      }),
      organizationId,
      hasConflict,
    });

    if (hasConflict) {
      return 'skipped';
    }

    this.logger.info({
      event: 'schedule_creation_start',
      ...this.buildLogContext({
        context,
        externalAppointmentId,
        patientExternalId,
        doctorExternalId,
        doctorUserId,
        patientUserId,
      }),
      organizationId,
    });

    const scheduleCreationPayload = this.buildScheduleCreationEventPayload({
      appointment,
      doctor: resolvedDoctor,
      patientUser: resolvedPatient,
      patientOrganizationId: organizationId,
      context,
    });

    if (!scheduleCreationPayload.patient?.userId || !scheduleCreationPayload.doctor?.userId) {
      throw new Error('Attempted to enqueue schedule creation without resolved users');
    }

    await publishScheduleCreation(scheduleCreationPayload);
    this.logger.info({
      event: 'schedule_creation_enqueued',
      ...this.buildLogContext({
        context,
        externalAppointmentId,
        patientExternalId,
        doctorExternalId,
        doctorUserId,
        patientUserId,
      }),
      organizationId,
    });

    return 'synced';
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

    this.logger.info({
      event: 'doctor_provisioning_start',
      ...this.buildLogContext({
        context,
        externalAppointmentId: String(validAppointments[0].appointmentId),
        doctorExternalId: String(validAppointments[0].doctor.id),
      }),
    });

    const doctor: CreatedUserInfo = await this.userProvisioningService.getOrCreateDoctor(
      validAppointments[0],
      context,
    );

    this.logger.info({
      event: 'doctor_provisioning_complete',
      ...this.buildLogContext({
        context,
        externalAppointmentId: String(validAppointments[0].appointmentId),
        doctorExternalId: String(validAppointments[0].doctor.id),
        doctorUserId: doctor.userId,
      }),
    });

    return this.processAppointments(
      validAppointments,
      doctor  ,
      context,
    );
  }

  private async processAppointments(
    appointments: Appointment[],
    doctor: CreatedUserInfo,
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
        const patientExternalId = String(appointment.patient.id);
        const doctorExternalId = String(appointment.doctor.id);

        try {
          const outcome = await this.processOneAppointment(
            appointment,
            doctor,
            context,
          );
          switch (outcome) {
            case 'synced':
              synced++;
              details.synced.push(externalAppointmentId);
              break;
            case 'skipped':
              skipped++;
              conflicts++;
              details.skipped.push(externalAppointmentId);
              break;
            case 'pending':
              pending++;
              details.pending.push(externalAppointmentId);
              break;
          }
        } catch (error) {
          failed++;
          details.failed.push(externalAppointmentId);

          this.logger.error({
            event: 'appointment_process_error',
            appointmentId: appointment.appointmentId,
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
            }),
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

  async getPendingAppointmentsByPatient(
    tenantId: string,
    patientExternalId: string,
    context: SSORequestContext,
  ): Promise<PendingAppointment[]> {
    return this.pendingAppointmentService.getPendingAppointmentsByPatient(
      tenantId,
      patientExternalId,
      context,
    );
  }
}