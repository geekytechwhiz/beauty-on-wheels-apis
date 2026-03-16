import { createChildLogger } from '@api-hub/logger';
import { RequestContext, SSORequestContext } from '../../context/request-context';
import {
  Appointment,
  Schedule,
  User,
} from '../../types';
import { CognitoUserContext } from '../../types/user/user.types';
import { FetchSchedulesRequest } from '../../types/appointment-sync.types';
import { TENANT_MAP } from '../../config/tenant-map-config';
import { loadTenantDetails } from '../../utils/helper';

type ScheduleClient = {
  fetchSchedules: (
    payload: FetchSchedulesRequest,
    context: RequestContext,
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
    context: RequestContext,
  ): Promise<boolean> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      appointmentId: appointment.appointmentId,
    });

    const subdomain = context.integration?.subdomain ?? '';
    const tenant = loadTenantDetails(subdomain);
    const payload: FetchSchedulesRequest = {
      fromDate: new Date(appointment.startTime).getTime(),
      toDate: new Date(appointment.endTime).getTime(),
      organizationID: tenant.organizationId,
      doctorId: String(doctorUser.userId),
      userId: String(patientUser.id),
    };

    const schedules = await this.scheduleClient.fetchSchedules(
      payload,
      context,
    );

    const externalAppointmentId = String(appointment.appointmentId);

    const hasDuplicate = schedules.some((schedule: Schedule) => {
      const hasMatchingMeta =
        schedule.meta?.externalAppointmentId === externalAppointmentId;

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

