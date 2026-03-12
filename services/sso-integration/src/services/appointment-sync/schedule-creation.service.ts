import { createChildLogger } from '@api-hub/logger';
import { RequestContext } from '../../context/request-context';
import { Appointment, Schedule, User } from '../../types';
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
    context: RequestContext,
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
          );

        logger.info({
          event: 'get_available_services_start',
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
          request: createServiceScheduleRequest,
        });

        const schedule = await this.scheduleClient.createServiceSchedule(
          createServiceScheduleRequest,
          context,
        );

        logger.info({
          event: 'create_service_schedule_success',
          scheduleId: schedule.scheduleId,
        });

        logger.info({
          event: 'update_service_status_start',
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
    context: RequestContext,
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

