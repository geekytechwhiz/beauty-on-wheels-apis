import { createChildLogger } from '@api-hub/observability';
import { SSORequestContext } from '../../types/common/context.types';
import {
  Appointment,
  Schedule,
  User,
} from '../../types';
import { FetchSchedulesRequest } from '../../types/domain/appointment.types';
import { CognitoUserContext } from '../../types/user/user.types';
import { loadTenantDetails } from '../../utils/helper';

/**
 * True when `stored` has the same value as `expected` for every key in `expected`.
 * Ignores keys only present on `stored` (e.g. correlationId, startTime format variants).
 */
function externalAppointmentPayloadMatches(
  stored: Record<string, unknown> | undefined,
  expected: Record<string, string>,
): boolean {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return false;
  }
  for (const [key, val] of Object.entries(expected)) {
    if (stored[key] === undefined) {
      return false;
    }
    if (String(stored[key]) !== String(val)) {
      return false;
    }
  }
  return true;
}

/**
 * Only stable HMS identifiers — avoids false mismatches from ISO time string / status formatting between systems.
 * Full `externalAppointment` blob still passes through fetchSchedules for clients.
 */
function buildExpectedExternalAppointmentKeys(
  appointment: Appointment,
  context: SSORequestContext,
): Record<string, string> {
  return {
    externalId: String(appointment.appointmentId),
    tenantId: context.tenantId,
  };
}

type ScheduleClient = {
  fetchSchedules: (
    payload: FetchSchedulesRequest,
    context: SSORequestContext,
  ) => Promise<Schedule[]>;
};

export class AppointmentIdempotencyService {
  constructor(
    private readonly scheduleClient: ScheduleClient,
    private readonly logger: any,
  ) {}

  async checkDuplicateSchedule(
    appointment: Appointment,
    doctorUser: CognitoUserContext,
    patientUser: User,
    context: SSORequestContext,
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

  async checkAppointmentIdempotency(
    appointment: Appointment,
    doctorUser: CognitoUserContext,
    patientUser: User,
    context: SSORequestContext,
  ): Promise<boolean> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      appointmentId: appointment.appointmentId,
    });

    const subdomain = context.integration?.subdomain ?? '';
    const tenant = loadTenantDetails(subdomain);
    const payload: FetchSchedulesRequest = {
      fromDate: new Date(appointment.startTime ?? '').getTime(),
      toDate: new Date(appointment.endTime ?? '').getTime(),
      organizationID: tenant.organizationId,
      doctorId: String(doctorUser.userId),
      userId: String(patientUser.id),
    };

    const schedules = await this.scheduleClient.fetchSchedules(
      payload,
      context,
    );

    const externalAppointmentId = String(appointment.appointmentId);
    const expectedExt = buildExpectedExternalAppointmentKeys(
      appointment,
      context,
    );

    const hasDuplicate = schedules.some((schedule: Schedule) => {
      const ext = schedule.meta?.externalAppointment as
        | Record<string, unknown>
        | undefined;

      const hasMatchingExternalAppointment =
        ext !== undefined &&
        externalAppointmentPayloadMatches(ext, expectedExt);

      const hasMatchingMetaId =
        schedule.meta?.externalAppointmentId === externalAppointmentId;

      const hasMatchingMeta =
        hasMatchingExternalAppointment || hasMatchingMetaId;

      const hasMatchingParticipants =
        schedule.participantInfo?.some(
          (p) =>
            p.userId === String(doctorUser.userId) && p.userType === 'STAFF',
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
}

