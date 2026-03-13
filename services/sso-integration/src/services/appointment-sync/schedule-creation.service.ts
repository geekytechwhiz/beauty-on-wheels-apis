import { createChildLogger, serializeError } from '@api-hub/logger'; 
import { Appointment, Schedule, SSORequestContext, User } from '../../types';
import { CognitoUserContext } from '../../types/user/user.types';
import { retryWithBackoff, RetryOptions } from '../../utils/retry.util';

type ScheduleClient = any;

type AppointmentMapper = any;

export class ScheduleCreationService {
  constructor(
    private readonly scheduleClient: ScheduleClient,
    private readonly appointmentMapper: AppointmentMapper,
    private readonly logger: any,
    private readonly retryOptions: RetryOptions,
  ) {}

  async createServiceScheduleWithRetry(
    appointment: Appointment,
    doctorUser: CognitoUserContext,
    patientUser: User,
    context: SSORequestContext,
  ): Promise<Schedule> {
    return retryWithBackoff(
      async () => {
        const logger = createChildLogger(this.logger, {
          correlationId: context.correlationId,
          appointmentId: appointment.appointmentId,
        });

        const getAvailableServicesRequest =
          this.appointmentMapper.mapAppointmentToGetAvailableServices(
            appointment,
            patientUser,
            context,
            doctorUser?.organizationId
          );

        logger.info({
          event: 'get_available_services_start',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: String(appointment.appointmentId),
          doctorExternalId: String(appointment.doctor.id),
          patientExternalId: String(appointment.patient.id),
          doctorUserId: String(doctorUser.userId),
          patientUserId: String(patientUser.id),
          request: getAvailableServicesRequest,
        });

        const availableServices =
          await this.scheduleClient.getAvailableServices(
            getAvailableServicesRequest,
            context,
          );

        if (!availableServices || availableServices.length === 0) {
          throw new Error('No available services found');
        }

        const orgAddonId = availableServices[0].orgAddonId;

        logger.info({
          event: 'get_available_services',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: String(appointment.appointmentId),
          doctorExternalId: String(appointment.doctor.id),
          patientExternalId: String(appointment.patient.id),
          doctorUserId: String(doctorUser.userId),
          patientUserId: String(patientUser.id),
          orgAddonId,
          availableServicesCount: availableServices.length,
        });

        const recommendServicesRequest =
          this.appointmentMapper.mapAppointmentToRecommendServices(
            appointment,
            doctorUser,
            patientUser,
            orgAddonId || '',
          );

        logger.info({
          event: 'recommend_services_start',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: String(appointment.appointmentId),
          doctorExternalId: String(appointment.doctor.id),
          patientExternalId: String(appointment.patient.id),
          doctorUserId: String(doctorUser.userId),
          patientUserId: String(patientUser.id),
          request: recommendServicesRequest,
        });

        const recommendResult = await this.scheduleClient.recommendServices(
          recommendServicesRequest,
          context,
        );

        if (!recommendResult?.userAddonId) {
          throw new Error('No userAddonId returned from recommend services');
        }

        const userAddonId = recommendResult.userAddonId;

        logger.info({
          event: 'recommend_services_success',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: String(appointment.appointmentId),
          doctorExternalId: String(appointment.doctor.id),
          patientExternalId: String(appointment.patient.id),
          doctorUserId: String(doctorUser.userId),
          patientUserId: String(patientUser.id),
          userAddonId,
        });

        const createServiceScheduleRequest =
          this.appointmentMapper.mapAppointmentToCreateServiceSchedule(
            appointment,
            doctorUser,
            patientUser,
            userAddonId,
          );

        logger.info({
          event: 'create_service_schedule_start',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: String(appointment.appointmentId),
          doctorExternalId: String(appointment.doctor.id),
          patientExternalId: String(appointment.patient.id),
          doctorUserId: String(doctorUser.userId),
          patientUserId: String(patientUser.id),
          request: createServiceScheduleRequest,
        });

        let schedule: Schedule;

        try {
          schedule = await this.scheduleClient.createServiceSchedule(
            createServiceScheduleRequest,
            context,
          );

          logger.info({
            event: 'create_service_schedule_success',
            correlationId: context.correlationId,
            tenantId: context.tenantId,
            externalAppointmentId: String(appointment.appointmentId),
            doctorExternalId: String(appointment.doctor.id),
            patientExternalId: String(appointment.patient.id),
            doctorUserId: String(doctorUser.userId),
            patientUserId: String(patientUser.id),
            scheduleId: schedule.scheduleId,
          });
        } catch (error: any) {
          // If downstream indicates the schedule already exists, treat as safe duplicate
          const isDuplicate =
            error?.message === 'Service schedule already exists' ||
            error?.code === 'ServiceScheduleExists' ||
            error?.response?.status === 409;

          if (isDuplicate) {
            logger.warn({
              event: 'create_service_schedule_duplicate_detected',
              correlationId: context.correlationId,
              tenantId: context.tenantId,
              externalAppointmentId: String(appointment.appointmentId),
              doctorExternalId: String(appointment.doctor.id),
              patientExternalId: String(appointment.patient.id),
              doctorUserId: String(doctorUser.userId),
              patientUserId: String(patientUser.id),
              appointmentId: appointment.appointmentId,
              err: serializeError(error as Error),
            });
            // Rethrow to let AppointmentIdempotencyService / upstream logic classify as duplicate,
            // but do not keep retrying this as a transient error.
            throw error;
          }

          logger.error({
            event: 'create_service_schedule_error',
            correlationId: context.correlationId,
            tenantId: context.tenantId,
            externalAppointmentId: String(appointment.appointmentId),
            doctorExternalId: String(appointment.doctor.id),
            patientExternalId: String(appointment.patient.id),
            doctorUserId: String(doctorUser.userId),
            patientUserId: String(patientUser.id),
            appointmentId: appointment.appointmentId,
            err: serializeError(error as Error),
          });

          throw error;
        }

        logger.info({
          event: 'update_service_status_start',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: String(appointment.appointmentId),
          doctorExternalId: String(appointment.doctor.id),
          patientExternalId: String(appointment.patient.id),
          doctorUserId: String(doctorUser.userId),
          patientUserId: String(patientUser.id),
          addonId: userAddonId,
          userId: String(patientUser.id),
        });

        await this.updateServiceStatusWithRetry(
          userAddonId,
          String(patientUser.id),
          context,
        );

        logger.info({
          event: 'update_service_status_success',
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          externalAppointmentId: String(appointment.appointmentId),
          doctorExternalId: String(appointment.doctor.id),
          patientExternalId: String(appointment.patient.id),
          doctorUserId: String(doctorUser.userId),
          patientUserId: String(patientUser.id),
          addonId: userAddonId,
          userId: String(patientUser.id),
        });

        return schedule;
      },
      this.retryOptions,
    );
  }

  async updateServiceStatusWithRetry(
    addonId: string,
    userId: string,
    context: SSORequestContext,
  ): Promise<void> {
    await retryWithBackoff(
      async () => {
        await this.scheduleClient.updateServiceStatus(
          {
            addonId,
            type: 'addon',
            userId,
            scheduleStatus: 'confirmed',
          },
          context,
        );
      },
      this.retryOptions,
    );
  }
}

