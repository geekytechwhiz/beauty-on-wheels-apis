import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  createChildLogger,
  createLogger,
  serializeError,
} from '@api-hub/logger';

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
  PendingAppointment,
} from '../types';
import { normalizeSchedulePayload } from '../utils/normalize-schedule-payload.util';

import { SSOError } from '../types/errors/sso-error';
import { SSORequestContext } from '../types/common/context.types';
import { loadTenantDetails } from '../utils/helper';

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
              schedules.push(
                this.mapScheduledItemToSchedule(
                  scheduledItem as unknown as any,
                ),
              );
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
      console.log('getAvailableServices payload', JSON.stringify(payload));
      const response =
        await this.packageServiceClient.post<GetAvailableServicesResponse>(
          '/services/get-available-services',
          payload,
          {
            headers: this.buildHeaders(context),
          },
        );

      // Extract items from data.items array
      const items = response.data.data?.items ?? [];

      // Map addonId to orgAddonId for compatibility
      return items.map((item) => ({
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
    const tenant = loadTenantDetails(context.integration?.subdomain);
    let addonId = '';
    try {
      const request = {
        ...payload,
        organizationId: tenant.organizationId,
        organizationID: tenant.organizationId,
      };
      console.log('recommendServices payload', JSON.stringify(request));
      const response =
        await this.packageServiceClient.post<RecommendServicesResponse>(
          '/services/recommend-services',
          request,
          {
            headers: this.buildHeaders(context),
          },
        );

      // The API returns data.userAddonId directly (not an array)
      addonId = response.data.data?.userAddonId ?? '';
      if (!addonId) {
        const userAddonDetails = await this.getUserAddonDetails(
          context,
          payload,
        );
        if (!userAddonDetails || userAddonDetails.length === 0) {
          throw new Error('No available services found');
        }
        addonId = userAddonDetails[0]?.userAddonId as string;
      }
      console.log('recommendServices response', JSON.stringify(response.data));
      return { userAddonId: addonId };
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

  async getUserAddonDetails(
    context: SSORequestContext,
    payload: RecommendServicesRequest,
  ): Promise<AvailableService[]> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });
    const request = { 
      userId: payload.userId,
      action: 'recommended',
    };
    try {
      console.log('getUserAddonDetails request', JSON.stringify(request));
      console.log('getUserAddonDetails headers', JSON.stringify(this.buildHeaders(context)));
      const response =
        await this.packageServiceClient.post<GetAvailableServicesResponse>(
          '/services/get-user-addon-service',
          request,
          {
        headers: this.buildHeaders(context),
          },
        );
      console.log('getUserAddonDetails response', JSON.stringify(response.data));
      const items = response.data?.data?.items ?? [];
      return items ?? [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error({
          event: 'get_all_addons_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });
        throw SSOError.downstreamError(
          `Get all addons failed: ${axiosError.message}`,
          axiosError,
        );
      }
      logger.error({
        event: 'get_all_addons_unexpected_error',
        err: serializeError(error as Error),
      });
      throw SSOError.downstreamError(
        'Unexpected error during get all addons',
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
      const normalizedPayload = normalizeSchedulePayload(payload);

      const response =
        await this.packageServiceClient.post<CreateServiceScheduleResponse>(
          '/services/create-schedule',
          normalizedPayload,
          {
            headers: this.buildHeaders(context),
          },
        );

      if (!response.data.data?.scheduleDetails) {
        throw new Error(
          'No schedule details returned from create service schedule',
        );
      }

      // Convert ScheduleDetails to Schedule format
      return this.mapScheduleDetailsToSchedule(
        response.data.data.scheduleDetails,
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        logger.error({
          event: 'create_service_schedule_error',
          status: axiosError.response?.status,
          responseData: axiosError.response?.data,
          requestPayload: payload,
          err: serializeError(axiosError),
        });

        if (axiosError.response?.status === 409) {
          throw SSOError.downstreamError(
            'Service schedule already exists',
            axiosError,
          );
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
      const response =
        await this.packageServiceClient.post<UpdateServiceStatusResponse>(
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

  // ---------------------------------------------------------------------------
  // Pending appointments (Scheduler service owns storage; these call Scheduler APIs)
  // ---------------------------------------------------------------------------

  async storePendingAppointment(
    tenantId: string,
    pending: PendingAppointment,
    context: SSORequestContext,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });
    try {
      await this.client.post(
        '/pending-appointments',
        {
          tenantId,
          appointmentExternalId: pending.externalAppointmentId,
          patientExternalId: pending.patientExternalId,
          doctorExternalId: pending.doctorExternalId,
          payload: pending,
          status: 'PENDING',
        },
        { headers: this.buildHeaders(context) },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          event: 'store_pending_appointment_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Store pending appointment failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Store pending appointment failed',
        error as Error,
      );
    }
  }

  async getPendingAppointmentsByPatient(
    tenantId: string,
    patientExternalId: string,
    context: SSORequestContext,
  ): Promise<PendingAppointment[]> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });
    try {
      const response = await this.client.get<{ items: PendingAppointment[] }>(
        '/internal/pending-appointments',
        {
          params: { tenantId, patientExternalId },
          headers: this.buildHeaders(context),
        },
      );
      return response.data?.items ?? [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          return [];
        }
        logger.error({
          event: 'get_pending_appointments_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Get pending appointments failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Get pending appointments failed',
        error as Error,
      );
    }
  }

  async removePendingAppointment(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
    context: SSORequestContext,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });
    try {
      await this.client.delete('/internal/pending-appointments', {
        params: { tenantId, patientExternalId, externalAppointmentId },
        headers: this.buildHeaders(context),
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          event: 'remove_pending_appointment_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Remove pending appointment failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Remove pending appointment failed',
        error as Error,
      );
    }
  }

  async updatePendingAppointmentRetryCount(
    tenantId: string,
    patientExternalId: string,
    externalAppointmentId: string,
    retryCount: number,
    context: SSORequestContext,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });
    try {
      await this.client.patch(
        '/internal/pending-appointments/retry-count',
        {
          tenantId,
          patientExternalId,
          externalAppointmentId,
          retryCount,
        },
        { headers: this.buildHeaders(context) },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          event: 'update_pending_retry_count_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Update pending appointment retry count failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Update pending appointment retry count failed',
        error as Error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Appointment idempotency (Scheduler service owns storage; these call Scheduler APIs)
  // ---------------------------------------------------------------------------

  async checkAppointmentIdempotency(
    tenantId: string,
    appointmentExternalId: string,
    context: SSORequestContext,
  ): Promise<{ alreadyProcessed: boolean; scheduleId?: string }> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });
    try {
      const response = await this.client.post<{
        alreadyProcessed: boolean;
        scheduleId?: string;
      }>(
        '/internal/appointment-idempotency/check',
        { tenantId, appointmentExternalId },
        { headers: this.buildHeaders(context) },
      );
      return response.data ?? { alreadyProcessed: false };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          event: 'check_appointment_idempotency_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Check appointment idempotency failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Check appointment idempotency failed',
        error as Error,
      );
    }
  }

  async markAppointmentProcessed(
    tenantId: string,
    appointmentExternalId: string,
    scheduleId: string,
    context: SSORequestContext,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });
    try {
      await this.client.post(
        '/internal/appointment-idempotency/mark',
        { tenantId, appointmentExternalId, scheduleId },
        { headers: this.buildHeaders(context) },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          event: 'mark_appointment_processed_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Mark appointment processed failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Mark appointment processed failed',
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
      appointmentType:
        (scheduledItem as { consultationType?: string }).consultationType ||
        'ONLINE',
      owner: scheduledItem.owner
        ? {
            userId: scheduledItem.owner.userId,
            userType: scheduledItem.owner.userType,
          }
        : {
            userId: '',
            userType: 'STAFF',
          },
      participantInfo: (scheduledItem.participantInfo || []).map((p) => ({
        userId: p.userId,
        userType: p.userType as 'STAFF' | 'USER',
        organizationID: p.organizationID || '',
      })),
      organizationID:
        (scheduledItem.participantInfo?.[0]?.organizationID as string) || '',
      meta: {
        externalAppointmentId: scheduledItem.scheduleId,
      },
    };
  }

  /**
   * Maps ScheduleDetails from the API response to Schedule format
   */
  private mapScheduleDetailsToSchedule(
    scheduleDetails: ScheduleDetails,
  ): Schedule {
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
      participantInfo: scheduleDetails.participantInfo.map((p) => ({
        userId: p.userId,
        userType: p.userType as 'STAFF' | 'USER',
        organizationID: p.organizationID,
      })),
      organizationID: scheduleDetails.organizationID,
      meta: {
        externalAppointmentId:
          scheduleDetails.id || scheduleDetails.scheduleId || '',
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
