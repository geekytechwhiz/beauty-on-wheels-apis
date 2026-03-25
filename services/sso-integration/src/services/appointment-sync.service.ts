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
import { publishCancellationReconciliation } from './appointment-sync/cancellation-reconciliation-queue.service';
import { CancellationReconciliationMessage } from '../types/events/cancellation-reconciliation-message.types';

const isPendingAppointmentBypassEnabled = (): boolean =>
  process.env.BYPASS_PENDING_APPOINTMENT === 'true';
const isCancellationReconciliationEnabled = (): boolean =>
  process.env.ENABLE_CANCELLED_APPOINTMENT_RECONCILIATION === 'true';

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
    pendingMetadata: Pick<
      PendingAppointment,
      'tenantId' | 'organizationID' | 'patientUserId' | 'doctorUserId'
    >,
    context: SSORequestContext,
  ): Promise<void> {
    await this.pendingAppointmentService.addPendingAppointment(
      context.tenantId,
      {
        appointment,
        reason,
        timestamp: new Date().toISOString(),
        retryCount: 0,
        appointmentId: `APT-${String(appointment.appointmentId)}`,
        tenantId: pendingMetadata.tenantId,
        organizationID: pendingMetadata.organizationID,
        patientUserId: pendingMetadata.patientUserId,
        doctorUserId: pendingMetadata.doctorUserId,
        patientExternalId: String(appointment.patient.id),
        doctorExternalId: String(appointment.doctor.id),
        externalAppointmentId: String(appointment.appointmentId),
      },
      context,
    );
  }

  private async handleUnresolvedPatient(params: {
    appointment: Appointment;
    context: SSORequestContext;
    externalAppointmentId: string;
    patientExternalId: string;
    doctorExternalId: string;
    organizationId: string;
    resolvedDoctorUserId?: string;
    resolvedDoctorForLog?: { userId?: string };
    resolvedPatientForLog?: User | null;
  }): Promise<void> {
    const {
      appointment,
      context,
      externalAppointmentId,
      patientExternalId,
      doctorExternalId,
      organizationId,
      resolvedDoctorUserId,
      resolvedDoctorForLog,
      resolvedPatientForLog,
    } = params;

    const existingPendingAppointments =
      await this.pendingAppointmentService.getPendingAppointmentsByPatient(
        context.tenantId,
        patientExternalId,
        context,
      );

    this.logger.info({
      event: 'pending_appointment_create',
      ...this.buildLogContext({
        context,
        externalAppointmentId,
        patientExternalId,
        doctorExternalId,
        doctorUserId: resolvedDoctorForLog?.userId,
        patientUserId: resolvedPatientForLog
          ? String(resolvedPatientForLog.id)
          : undefined,
      }),
      existingPendingCount: existingPendingAppointments.length,
    });

    await this.enqueuePendingAppointment(
      appointment,
      'user_not_resolved',
      {
        tenantId: context.tenantId,
        organizationID: organizationId,
        doctorUserId: resolvedDoctorForLog?.userId,
        patientUserId: resolvedPatientForLog
          ? String(resolvedPatientForLog.id)
          : undefined,
      },
      context,
    );

    if (existingPendingAppointments.length > 0) {
      this.logger.info({
        event: 'patient_creation_event_enqueue_skipped_existing_pending',
        ...this.buildLogContext({
          context,
          externalAppointmentId,
          patientExternalId,
          doctorExternalId,
          doctorUserId: resolvedDoctorUserId,
        }),
        organizationId,
        existingPendingCount: existingPendingAppointments.length,
      });
      return;
    }

    const provider = context.integration?.providerId ?? 'TruTech';

    if (!resolvedDoctorUserId) {
      this.logger.warn({
        event: 'patient_creation_event_without_resolved_doctor',
        ...this.buildLogContext({
          context,
          externalAppointmentId,
          patientExternalId,
          doctorExternalId,
        }),
        organizationId,
        message:
          'Publishing patient creation event without doctor userId; patient creation can continue, but doctor assignment will be skipped until doctor provisioning completes',
      });
    }

    const patientEvent = this.patientEventPublisher.createPatientCreationEvent(
      appointment.patient,
      organizationId,
      provider,
      context,
      resolvedDoctorUserId,
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
        doctorUserId: resolvedDoctorUserId,
      }),
      organizationId,
    });
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

    if (isCancellationReconciliationEnabled()) {
      try {
        logger.info({
          event: 'reconciliation_enqueue_start',
          tenantId: context.tenantId,
          correlationId: context.correlationId,
          appointmentCount: appointments.length,
          fromDate,
          toDate,
        });
        await this.enqueueCancellationReconciliation(
          appointments,
          context,
          fromDate,
          toDate,
        );
      } catch (error) {
        logger.error({
          event: 'reconciliation_enqueue_failed',
          tenantId: context.tenantId,
          correlationId: context.correlationId,
          err: serializeError(error as Error),
        });
      }
    } else {
      logger.debug({
        event: 'reconciliation_enqueue_skipped',
        reason: 'feature_flag_disabled',
        tenantId: context.tenantId,
        correlationId: context.correlationId,
      });
    }

    const results = await this.syncDoctorAppointments(appointments, context);

    logger.info({
      event: 'appointment_sync_complete',
      ...results,
    });

    return results;
  }

  private async enqueueCancellationReconciliation(
    appointments: Appointment[],
    context: SSORequestContext,
    fromDate: string,
    toDate: string,
  ): Promise<void> {
    const subdomain = context.integration?.subdomain ?? '';
    const organizationId = loadTenantDetails(subdomain).organizationId;
    const message: CancellationReconciliationMessage = {
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      organizationId,
      fromDate,
      toDate,
      appointments: appointments.map((appointment) => ({
        externalAppointmentId: String(appointment.appointmentId),
        doctorExternalId: String(appointment.doctor.id),
        patientExternalId: String(appointment.patient.id),
        startTime: appointment.startTime,
        endTime: appointment.endTime,
      })),
    };

    await publishCancellationReconciliation(message);
    this.logger.info({
      event: 'reconciliation_enqueue_success',
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      organizationId,
      appointmentCount: message.appointments.length,
    });
  }

  async reconcileMissingAppointmentsAsCancelledFromQueue(
    message: CancellationReconciliationMessage,
    context: SSORequestContext,
  ): Promise<{ cancelled: number; failed: number; skipped: number }> {
    const isDateOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
    const fromDateMs = this.parseDateToEpoch(message.fromDate);
    let toDateMs = this.parseDateToEpoch(message.toDate);
    // When toDate is provided as YYYY-MM-DD, Date parsing yields start-of-day.
    // Expand to cover the full day by moving to next day's start.
    if (isDateOnly(message.toDate) && Number.isFinite(toDateMs)) {
      toDateMs = toDateMs + 24 * 60 * 60 * 1000;
    }
    if (!Number.isFinite(fromDateMs) || !Number.isFinite(toDateMs)) {
      throw new Error('Invalid reconciliation window dates');
    }

    const doctorExternalIds = [
      ...new Set(message.appointments.map((a) => a.doctorExternalId)),
    ];
    const sourceExternalAppointmentIds = new Set(
      message.appointments
        .map((a) => a.externalAppointmentId?.trim())
        .filter((id): id is string => !!id),
    );

    this.logger.info({
      event: 'reconciliation_worker_start',
      tenantId: message.tenantId,
      correlationId: message.correlationId,
      organizationId: message.organizationId,
      fromDate: message.fromDate,
      toDate: message.toDate,
      inputAppointments: message.appointments.length,
      doctorCount: doctorExternalIds.length,
    });

    const internalDoctorToKeys = new Map<string, Set<string>>();
    const patientExternalToInternal = new Map<string, string>();
    for (const doctorExternalId of doctorExternalIds) {
      const doctorUser = await this.ssoUserServiceClient.findUserByExternalId(
        { externalId: doctorExternalId },
        context,
      );
      console.log("doctorUser", JSON.stringify(doctorUser))
      if (!doctorUser?.id) {
        continue;
      }
      console.log("doctorUser found", JSON.stringify(doctorUser))
      const internalDoctorId = String(doctorUser.id);
      const keys = new Set(
        message.appointments
          .filter((a) => a.doctorExternalId === doctorExternalId)
          .map(async (a) => {
            let internalPatientId = patientExternalToInternal.get(a.patientExternalId);
            if (!internalPatientId) {
              const patientUser = await this.ssoUserServiceClient.findUserByExternalId(
                { externalId: a.patientExternalId },
                context,
              );
              if (!patientUser?.id) {
                return null;
              }
              internalPatientId = String(patientUser.id);
              patientExternalToInternal.set(a.patientExternalId, internalPatientId);
            }

            return this.buildMatchKey(
              internalDoctorId,
              internalPatientId,
              this.parseDateToEpoch(a.startTime),
              this.parseDateToEpoch(a.endTime),
            );
          }),
      );

      console.log("keys", JSON.stringify(keys))
      const resolvedKeys = await Promise.all(Array.from(keys));
      console.log("resolvedKeys", JSON.stringify(resolvedKeys))
      internalDoctorToKeys.set(
        internalDoctorId,
        new Set(resolvedKeys.filter((k): k is string => !!k)),
      );
    }

    const fetchedSchedules = await this.scheduleClient.fetchSchedules(
      {
        fromDate: fromDateMs,
        toDate: toDateMs,
        organizationID: message.organizationId,
      },
      context,
    );

    console.log("fetchedSchedules", JSON.stringify(fetchedSchedules))

    this.logger.info({
      event: 'reconciliation_schedules_fetched',
      tenantId: message.tenantId,
      correlationId: message.correlationId,
      organizationId: message.organizationId,
      fetchedScheduleCount: fetchedSchedules.length,
      doctorMatchSetCount: internalDoctorToKeys.size,
    });

    let cancelled = 0;
    let failed = 0;
    let skipped = 0;
    let skippedNonConfirmed = 0;
    let skippedMissingFields = 0;
    let skippedFoundInSourceByExternalId = 0;
    let skippedMatchedByKey = 0;

    for (const schedule of fetchedSchedules) {
      const status = (
        schedule.scheduledStatus ||
        schedule.serviceStatus ||
        ''
      ).toLowerCase();
      if (status !== 'confirmed') {
        skipped++;
        skippedNonConfirmed++;
        continue;
      }

      const doctorId = schedule.assignedStaffId || schedule.owner?.userId;
      const patientUserId = schedule.patientUserId || this.resolvePatientUserIdFromSchedule(schedule);
      const addonId = schedule.userAddonId;
      const organizationId = schedule.organizationId || schedule.organizationID;
      const metaObj = schedule.meta as Record<string, unknown> | undefined;
      const extObj = (metaObj?.externalAppointment as Record<string, unknown> | undefined);
      const fetchedExternalAppointmentId =
        (extObj?.externalId != null ? String(extObj.externalId) : '')?.trim() ||
        (metaObj?.externalAppointmentId != null ? String(metaObj.externalAppointmentId) : '')?.trim();
      if (!doctorId || !patientUserId || !addonId || !organizationId) {
        skipped++;
        skippedMissingFields++;
        this.logger.warn({
          event: 'reconciliation_skip_missing_fields',
          doctorId,
          patientUserId,
          addonId,
          organizationId,
          scheduleId: schedule.scheduleId,
        });
        continue;
      }

      // Fast-path: if this external appointment still exists in TruTech response,
      // this schedule must not be cancelled.
      if (
        fetchedExternalAppointmentId &&
        sourceExternalAppointmentIds.has(fetchedExternalAppointmentId)
      ) {
        skipped++;
        skippedFoundInSourceByExternalId++;
        continue;
      }

      const startEpoch = this.parseScheduleEpoch(
        schedule.scheduleTimeStamp,
        schedule.scheduleDate,
        schedule.startTime,
      );
      const endEpoch = this.parseScheduleEpoch(
        undefined,
        schedule.scheduleDate,
        schedule.endTime,
      );
      const scheduleKey = this.buildMatchKey(
        doctorId,
        patientUserId,
        startEpoch,
        endEpoch,
      );

      console.log("startEpoch", startEpoch)
      console.log("scheduleKey", scheduleKey)

      // If TruTech did not return any appointment for this doctor in the window,
      // we should treat fetched schedules as cancel candidates (not skip).
      const doctorKeys = internalDoctorToKeys.get(doctorId) ?? new Set<string>();
      console.log("doctorKeys", doctorKeys)

      if (doctorKeys.has(scheduleKey)) {
        skipped++;
        skippedMatchedByKey++;
        continue;
      }

      try {
        this.logger.info({
          event: 'reconciliation_cancel_candidate',
          tenantId: message.tenantId,
          correlationId: message.correlationId,
          scheduleId: schedule.scheduleId,
          doctorId,
          patientUserId,
          addonId,
          organizationId,
        });
        await this.cancelConfirmedScheduleWithRetry(
          addonId,
          patientUserId,
          organizationId,
          context,
        );
        cancelled++;
        this.logger.info({
          event: 'reconciliation_cancel_success',
          tenantId: message.tenantId,
          correlationId: message.correlationId,
          scheduleId: schedule.scheduleId,
          addonId,
          patientUserId,
          organizationId,
        });
      } catch (error) {
        failed++;
        this.logger.error({
          event: 'reconciliation_cancel_failed',
          addonId,
          patientUserId,
          organizationId,
          scheduleId: schedule.scheduleId,
          err: serializeError(error as Error),
        });
      }
    }

    this.logger.info({
      event: 'reconciliation_worker_complete',
      tenantId: message.tenantId,
      correlationId: message.correlationId,
      organizationId: message.organizationId,
      cancelled,
      failed,
      skipped,
      skippedNonConfirmed,
      skippedMissingFields,
      skippedFoundInSourceByExternalId,
      skippedMatchedByKey,
      fetchedScheduleCount: fetchedSchedules.length,
    });

    return { cancelled, failed, skipped };
  }

  private async cancelConfirmedScheduleWithRetry(
    addonId: string,
    userId: string,
    organizationId: string,
    context: SSORequestContext,
  ): Promise<void> {
    let delayMs = this.initialDelayMs;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.scheduleClient.updateServiceStatus(
          {
            addonId,
            type: 'addon',
            userId,
            organizationId,
            scheduleStatus: 'cancelled',
          },
          context,
        );
        return;
      } catch (error) {
        if (attempt >= this.maxRetries) {
          throw error;
        }
        await this.sleep(delayMs);
        delayMs = Math.min(delayMs * 2, this.maxDelayMs);
      }
    }
  }

  private resolvePatientUserIdFromSchedule(schedule: {
    participantInfo?: Array<{ userId: string; userType: string }>;
  }): string | undefined {
    return schedule.participantInfo?.find((p) => p.userType === 'USER')?.userId;
  }

  private buildMatchKey(
    doctorId: string,
    patientId: string,
    startEpoch: number,
    endEpoch: number,
  ): string {
    // Use stable identity (doctor + patient + start) to avoid false mismatches
    // from end-time timezone/format differences between systems.
    void endEpoch;
    return `doctor::${doctorId}|patient::${patientId}|start::${startEpoch}`;
  }

  private parseDateToEpoch(input: string): number {
    const asNumber = Number(input);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
    return new Date(input).getTime();
  }

  private parseScheduleEpoch(
    scheduleTimeStamp?: string,
    scheduleDate?: string,
    timeText?: string,
  ): number {
    if (scheduleTimeStamp) {
      const parsed = Number(scheduleTimeStamp);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    if (!scheduleDate || !timeText) {
      return Number.NaN;
    }

    // scheduleDate format expected: DD-MM-YYYY
    const [day, month, year] = scheduleDate.split('-').map(Number);
    if (!day || !month || !year) {
      return Number.NaN;
    }

    const timeMatch = timeText.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!timeMatch) {
      return Number.NaN;
    }

    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const meridian = timeMatch[3].toUpperCase();
    if (meridian === 'PM' && hour < 12) hour += 12;
    if (meridian === 'AM' && hour === 12) hour = 0;

    return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

    const [initialResolvedPatient, initialResolvedDoctor] = await Promise.all([
      this.resolvePatientUser(appointment, context),
      this.resolveDoctorUser(appointment, context),
    ]);

    let resolvedPatient = initialResolvedPatient;
    const resolvedDoctor = initialResolvedDoctor ?? doctor;

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
      const resolvedDoctorUserId = resolvedDoctor?.userId
        ? String(resolvedDoctor.userId)
        : undefined;

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

      if (isPendingAppointmentBypassEnabled() && !resolvedPatient?.id) {
        try {
          resolvedPatient = await this.userProvisioningService.getOrCreatePatient(
            appointment,
            context,
          );
          this.logger.info({
            event: 'patient_created_inline_with_bypass',
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
              doctorUserId: resolvedDoctorUserId,
              patientUserId: String(resolvedPatient.id),
            }),
            message:
              'BYPASS_PENDING_APPOINTMENT enabled - patient created inline, continuing appointment processing',
          });
        } catch (err) {
          this.logger.error({
            event: 'patient_inline_creation_failed_with_bypass',
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
              doctorUserId: resolvedDoctorUserId,
            }),
            err: serializeError(err as Error),
          });
        }
      }

      if (!resolvedPatient?.id && !isPendingAppointmentBypassEnabled()) {
        try {
          await this.handleUnresolvedPatient({
            appointment,
            context,
            externalAppointmentId,
            patientExternalId,
            doctorExternalId,
            organizationId,
            resolvedDoctorUserId,
            resolvedDoctorForLog: resolvedDoctor,
            resolvedPatientForLog: resolvedPatient,
          });
        } catch (err) {
          this.logger.error({
            event: 'patient_creation_event_publish_failed_from_sync',
            ...this.buildLogContext({
              context,
              externalAppointmentId,
              patientExternalId,
              doctorExternalId,
              doctorUserId: resolvedDoctorUserId,
            }),
            err: serializeError(err as Error),
          });
        }
      }

      if (isPendingAppointmentBypassEnabled() && !resolvedPatient?.id) {
        this.logger.info({
          event: 'pending_appointment_bypassed',
          message:
            'BYPASS_PENDING_APPOINTMENT enabled - skipping pending appointment persistence and waiting for a follow-up sync call',
          ...this.buildLogContext({
            context,
            externalAppointmentId,
            patientExternalId,
            doctorExternalId,
            doctorUserId: resolvedDoctor?.userId,
            patientUserId: resolvedPatient ? String(resolvedPatient.id) : undefined,
          }),
        });
      }

      if (!resolvedPatient?.id || !resolvedDoctor?.userId) {
        return 'pending';
      }
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