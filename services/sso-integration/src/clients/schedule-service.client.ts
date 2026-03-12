import axios, { AxiosError, AxiosInstance } from 'axios';
import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';

import { getEnvConfig } from '../config/env';
import {
  FetchSchedulesRequest,
  FetchSchedulesResponse,
  Schedule,
  GetAvailableServicesRequest,
  GetAvailableServicesResponse,
  AvailableService,
  RecommendServicesRequest,
  RecommendServicesResponse,
  CreateServiceScheduleRequest,
  CreateServiceScheduleResponse,
  UpdateServiceStatusRequest,
  UpdateServiceStatusResponse,
  ScheduleDetails,
} from '../types';

  import { SSOError } from '../types/errors/sso-error';
  import { SSORequestContext } from '../types/common/context.types';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class ScheduleServiceClient {

  private readonly client: AxiosInstance;
  private readonly packageServiceClient: AxiosInstance;

  private readonly logger = createChildLogger(baseLogger, {
    component: 'ScheduleServiceClient',
  });

  constructor() {
    const config = getEnvConfig();

    this.client = axios.create({
      baseURL: config.SCHEDULE_SERVICE_API_URL,
      timeout: config.SCHEDULE_SERVICE_API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.packageServiceClient = axios.create({
      baseURL: config.PACKAGE_SERVICE_API_URL,
      timeout: config.PACKAGE_SERVICE_API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {

        this.logger.error({
          event: 'schedule_service_request_error',
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
        });

        return Promise.reject(error);
      },
    );

    this.packageServiceClient.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {

        this.logger.error({
          event: 'package_service_request_error',
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
        });

        return Promise.reject(error);
      },
    );
  }

  private buildHeaders(context: SSORequestContext): Record<string, string> {
    const config = getEnvConfig();

    return {
      'X-Correlation-Id': context.correlationId,
      Authorization: `Bearer ${config.INTERNAL_SERVICE_TOKEN}`,
    };
  }

  async fetchSchedules(
    payload: FetchSchedulesRequest,
    context: SSORequestContext,
  ): Promise<Schedule[]> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.client.post<FetchSchedulesResponse>(
        '/fetch/schedules',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      // Extract schedules from the response structure
      // The API returns data.items, where each item has scheduled[] or schedule object
      const schedules: Schedule[] = [];
      
      if (response.data.data?.items) {
        for (const item of response.data.data.items) {
          // Check if item has scheduled array
          if (item.scheduled && Array.isArray(item.scheduled)) {
            for (const scheduledItem of item.scheduled) {
              schedules.push(this.mapScheduledItemToSchedule(scheduledItem as unknown as any));
            }
          }
          // Check if item has schedule object
          else if (item.schedule) {
            schedules.push(this.mapScheduleDetailsToSchedule(item.schedule));
          }
        }
      }

      return schedules;

    } catch (error) {

      if (axios.isAxiosError(error)) {

        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 400) {
          logger.warn({
            event: 'schedule_fetch_bad_request_treated_as_empty',
            payload,
            err: serializeError(axiosError),
          });

          return [];
        }

        if (axiosError.response?.status === 404) {

          logger.info({
            event: 'schedule_fetch_not_found',
            payload,
          });

          return [];
        }

        logger.error({
          event: 'schedule_fetch_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.downstreamError(
          `Schedule service fetch failed: ${axiosError.message}`,
          axiosError,
        );
      }

      logger.error({
        event: 'schedule_fetch_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Unexpected error during schedule fetch',
        error as Error,
      );
    }
  }

  

  // Service-based schedule creation methods
  async getAvailableServices(
    payload: GetAvailableServicesRequest,
    context: SSORequestContext,
  ): Promise<AvailableService[]> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {
      console.log("getAvailableServices payload", JSON.stringify(payload));
      const response = await this.packageServiceClient.post<GetAvailableServicesResponse>(
        '/services/get-available-services',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      // Extract items from data.items array
      const items = response.data.data?.items ?? [];
      
      // Map addonId to orgAddonId for compatibility
      return items.map(item => ({
        ...item,
        orgAddonId: item.addonId || item.orgAddonId,
      }));

    } catch (error) {

      if (axios.isAxiosError(error)) {

        const axiosError = error as AxiosError;

        logger.error({
          event: 'get_available_services_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.downstreamError(
          `Get available services failed: ${axiosError.message}`,
          axiosError,
        );
      }

      logger.error({
        event: 'get_available_services_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Unexpected error during get available services',
        error as Error,
      );
    }
  }

  async recommendServices(
    payload: RecommendServicesRequest,
    context: SSORequestContext,
  ): Promise<{ userAddonId: string }> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {
      console.log("recommendServices payload", JSON.stringify(payload));
      const response = await this.packageServiceClient.post<RecommendServicesResponse>(
        '/services/recommend-services',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      // The API returns data.userAddonId directly (not an array)
      if (!response.data.data?.userAddonId) {
        throw new Error('No userAddonId returned from recommend services');
      }

      return { userAddonId: response.data.data.userAddonId };

    } catch (error) {

      if (axios.isAxiosError(error)) {

        const axiosError = error as AxiosError;

        logger.error({
          event: 'recommend_services_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.downstreamError(
          `Recommend services failed: ${axiosError.message}`,
          axiosError,
        );
      }

      logger.error({
        event: 'recommend_services_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Unexpected error during recommend services',
        error as Error,
      );
    }
  }

  async createServiceSchedule(
    payload: CreateServiceScheduleRequest,
    context: SSORequestContext,
  ): Promise<Schedule> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.packageServiceClient.post<CreateServiceScheduleResponse>(
        '/services/create-schedule',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      if (!response.data.data?.scheduleDetails) {
        throw new Error('No schedule details returned from create service schedule');
      }

      // Convert ScheduleDetails to Schedule format
      return this.mapScheduleDetailsToSchedule(response.data.data.scheduleDetails);

    } catch (error) {

      if (axios.isAxiosError(error)) {

        const axiosError = error as AxiosError;

        logger.error({
          event: 'create_service_schedule_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        if (axiosError.response?.status === 409) {
          throw SSOError.downstreamError('Service schedule already exists', axiosError);
        }

        throw SSOError.downstreamError(
          `Service schedule creation failed: ${axiosError.message}`,
          axiosError,
        );
      }

      logger.error({
        event: 'create_service_schedule_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Unexpected error during service schedule creation',
        error as Error,
      );
    }
  }

  async updateServiceStatus(
    payload: UpdateServiceStatusRequest,
    context: SSORequestContext,
  ): Promise<UpdateServiceStatusResponse> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.packageServiceClient.post<UpdateServiceStatusResponse>(
        '/services/update-status',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      return response.data;

    } catch (error) {

      if (axios.isAxiosError(error)) {

        const axiosError = error as AxiosError;

        logger.error({
          event: 'update_service_status_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.downstreamError(
          `Update service status failed: ${axiosError.message}`,
          axiosError,
        );
      }

      logger.error({
        event: 'update_service_status_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Unexpected error during service status update',
        error as Error,
      );
    }
  }

  /**
   * Maps a scheduled item from the API response to Schedule format
   */
  private mapScheduledItemToSchedule(scheduledItem: {
    scheduleId: string;
    startTime: string;
    endTime: string;
    scheduleDate: string;
    scheduleTimeStamp?: string;
    participantInfo?: Array<{
      userId: string;
      userType: string;
      organizationID?: string;
      [key: string]: unknown;
    }>;
    owner?: {
      userId: string;
      userType: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }): Schedule {
    return {
      scheduleId: scheduledItem.scheduleId,
      startTime: scheduledItem.startTime,
      endTime: scheduledItem.endTime,
      scheduleDate: scheduledItem.scheduleDate,
      appointmentType: (scheduledItem as { consultationType?: string }).consultationType || 'ONLINE',
      owner: scheduledItem.owner ? {
        userId: scheduledItem.owner.userId,
        userType: scheduledItem.owner.userType,
      } : {
        userId: '',
        userType: 'STAFF',
      },
      participantInfo: (scheduledItem.participantInfo || []).map(p => ({
        userId: p.userId,
        userType: p.userType as 'STAFF' | 'USER',
        organizationID: p.organizationID || '',
      })),
      organizationID: (scheduledItem.participantInfo?.[0]?.organizationID as string) || '',
      meta: {
        externalAppointmentId: scheduledItem.scheduleId,
      },
    };
  }

  /**
   * Maps ScheduleDetails from the API response to Schedule format
   */
  private mapScheduleDetailsToSchedule(scheduleDetails: ScheduleDetails): Schedule {
    return {
      scheduleId: scheduleDetails.id || scheduleDetails.scheduleId || '',
      startTime: scheduleDetails.startTime,
      endTime: scheduleDetails.endTime,
      scheduleDate: scheduleDetails.scheduleDate,
      appointmentType: scheduleDetails.appointmentType || 'ONLINE',
      owner: {
        userId: scheduleDetails.owner.userId,
        userType: scheduleDetails.owner.userType,
      },
      participantInfo: scheduleDetails.participantInfo.map(p => ({
        userId: p.userId,
        userType: p.userType as 'STAFF' | 'USER',
        organizationID: p.organizationID,
      })),
      organizationID: scheduleDetails.organizationID,
      meta: {
        externalAppointmentId: scheduleDetails.id || scheduleDetails.scheduleId || '',
        ...scheduleDetails.meta,
      },
    };
  }
}

let scheduleServiceClientInstance: ScheduleServiceClient | null = null;

export function getScheduleServiceClient(): ScheduleServiceClient {

  if (!scheduleServiceClientInstance) {
    scheduleServiceClientInstance = new ScheduleServiceClient();
  }

  return scheduleServiceClientInstance;
}