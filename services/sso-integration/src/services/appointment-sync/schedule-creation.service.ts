import { createChildLogger, serializeError } from '@api-hub/logger';
import {
  getScheduleServiceClient,
  ScheduleServiceClient,
} from '../../clients/schedule-service.client';
import {
  AppointmentMapper,
  getAppointmentMapper,
} from '../../mappers/appointment.mapper';
import { Schedule, SSORequestContext } from '../../types';
import { ScheduleCreationEventPayload } from '../../types/events/schedule-creation-message.types';
import { RetryOptions, retryWithBackoff } from '../../utils/retry.util';

export class ScheduleCreationService {
  constructor(
    private readonly scheduleClient: ScheduleServiceClient,
    private readonly appointmentMapper: AppointmentMapper,
    private readonly logger: any,
    private readonly retryOptions: RetryOptions,
  ) {
    this.scheduleClient = getScheduleServiceClient();
    this.appointmentMapper = getAppointmentMapper();
  }

  async createServiceScheduleWithRetry(
    eventPayload: ScheduleCreationEventPayload,
    context: SSORequestContext,
  ): Promise<Schedule> {
    return retryWithBackoff(async () => {
      const logger = createChildLogger(this.logger, {
        correlationId: context.correlationId,
        appointmentId: eventPayload.appointment.externalId,
      });

      const getAvailableServicesRequest =
        this.appointmentMapper.mapAppointmentToGetAvailableServices(
          eventPayload,
          context,
        );

      logger.info({
        event: 'get_available_services_start',
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        externalAppointmentId: eventPayload.appointment.externalId,
        doctorExternalId: eventPayload.doctor.externalUserId,
        patientExternalId: eventPayload.patient.externalUserId,
        doctorUserId: eventPayload.doctor.userId,
        patientUserId: eventPayload.patient.userId,
        request: getAvailableServicesRequest,
      });

      const availableServices = await this.scheduleClient.getAvailableServices(
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
        externalAppointmentId: eventPayload.appointment.externalId,
        doctorExternalId: eventPayload.doctor.externalUserId,
        patientExternalId: eventPayload.patient.externalUserId,
        doctorUserId: eventPayload.doctor.userId,
        patientUserId: eventPayload.patient.userId,
        orgAddonId,
        availableServicesCount: availableServices.length,
      });

      const recommendServicesRequest =
        this.appointmentMapper.mapAppointmentToRecommendServices(
          eventPayload,
          orgAddonId,
          context,
        );

      logger.info({
        event: 'recommend_services_start',
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        externalAppointmentId: eventPayload.appointment.externalId,
        doctorExternalId: eventPayload.doctor.externalUserId,
        patientExternalId: eventPayload.patient.externalUserId,
        doctorUserId: eventPayload.doctor.userId,
        patientUserId: eventPayload.patient.userId,
        request: recommendServicesRequest,
      });

      const { userAddonId } = await this.scheduleClient.recommendServices(
        recommendServicesRequest,
        context,
      ); 
      if (!userAddonId) {
        
        throw new Error('No available services found');
      }  

      logger.info({
        event: 'recommend_services_success',
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        externalAppointmentId: eventPayload.appointment.externalId,
        doctorExternalId: eventPayload.doctor.externalUserId,
        patientExternalId: eventPayload.patient.externalUserId,
        doctorUserId: eventPayload.doctor.userId,
        patientUserId: eventPayload.patient.userId,
        userAddonI: userAddonId ,
      });

      const createServiceScheduleRequest =
        this.appointmentMapper.mapAppointmentToCreateServiceSchedule(
          eventPayload,
          userAddonId,
        );

      logger.info({
        event: 'create_service_schedule_start',
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        externalAppointmentId: eventPayload.appointment.externalId,
        doctorExternalId: eventPayload.doctor.externalUserId,
        patientExternalId: eventPayload.patient.externalUserId,
        doctorUserId: eventPayload.doctor.userId,
        patientUserId: eventPayload.patient.userId,
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
          externalAppointmentId: eventPayload.appointment.externalId,
          doctorExternalId: eventPayload.doctor.externalUserId,
          patientExternalId: eventPayload.patient.externalUserId,
          doctorUserId: eventPayload.doctor.userId,
          patientUserId: eventPayload.patient.userId,
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
            externalAppointmentId: eventPayload.appointment.externalId,
            doctorExternalId: eventPayload.doctor.externalUserId,
            patientExternalId: eventPayload.patient.externalUserId,
            doctorUserId: eventPayload.doctor.userId,
            patientUserId: eventPayload.patient.userId,
            appointmentId: eventPayload.appointment.externalId,
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
          externalAppointmentId: eventPayload.appointment.externalId,
          doctorExternalId: eventPayload.doctor.externalUserId,
          patientExternalId: eventPayload.patient.externalUserId,
          doctorUserId: eventPayload.doctor.userId,
          patientUserId: eventPayload.patient.userId,
          appointmentId: eventPayload.appointment.externalId,
          err: serializeError(error as Error),
        });

        throw error;
      }

      logger.info({
        event: 'update_service_status_start',
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        externalAppointmentId: eventPayload.appointment.externalId,
        organizationId: eventPayload.patient.organizationId,
        doctorExternalId: eventPayload.doctor.externalUserId,
        patientExternalId: eventPayload.patient.externalUserId,
        doctorUserId: eventPayload.doctor.userId,
        patientUserId: eventPayload.patient.userId,
        addonId: userAddonId,
        userId: eventPayload.patient.userId,
      });

      await this.updateServiceStatusWithRetry(
        userAddonId,
        eventPayload.patient.userId,
        eventPayload.patient.organizationId,
        context,
      );

      logger.info({
        event: 'update_service_status_success',
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        externalAppointmentId: eventPayload.appointment.externalId,
        doctorExternalId: eventPayload.doctor.externalUserId,
        patientExternalId: eventPayload.patient.externalUserId,
        doctorUserId: eventPayload.doctor.userId,
        patientUserId: eventPayload.patient.userId,
        addonId: userAddonId,
        userId: eventPayload.patient.userId,
      });

      return schedule;
    }, this.retryOptions);
  }

  async updateServiceStatusWithRetry(
    addonId: string,
    userId: string,
    organizationId: string,
    context: SSORequestContext,
  ): Promise<void> {
    console.log(
      'updateServiceStatusWithRetry: start',
      JSON.stringify({
        addonId,
        userId,
        organizationId,
        correlationId: context.correlationId,
      }),
    );
    await retryWithBackoff(async () => {
      const payload = {
        addonId,
        type: 'addon' as const,
        userId,
        organizationId,
        scheduleStatus: 'confirmed' as const,
        paymentStatus: 'completed' as const,
      };
      console.log(
        'updateServiceStatusWithRetry: calling updateServiceStatus',
        JSON.stringify({ payload, correlationId: context.correlationId }),
      );
      try {
        const response = await this.scheduleClient.updateServiceStatus(
          payload,
          context,
        );
        console.log(
          'updateServiceStatusWithRetry: updateServiceStatus response',
          JSON.stringify({ response, correlationId: context.correlationId }),
        );
      } catch (err) {
        console.error(
          'updateServiceStatusWithRetry: updateServiceStatus error',
          JSON.stringify({
            err,
            addonId,
            userId,
            organizationId,
            correlationId: context.correlationId,
          }),
        );
        throw err;
      }
    }, this.retryOptions);
    console.log(
      'updateServiceStatusWithRetry: complete',
      JSON.stringify({
        addonId,
        userId,
        organizationId,
        correlationId: context.correlationId,
      }),
    );
  }
}
