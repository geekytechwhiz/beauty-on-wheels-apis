import axios, { AxiosError, AxiosInstance } from 'axios';
import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';

import { getEnvConfig } from '../config/env';
import {
  FetchSchedulesRequest,
  Schedule,
  GetAvailableServicesRequest,
  GetAvailableServicesResponse,
  AvailableService,
  RecommendServicesRequest,
  RecommendServicesResponse,
  RecommendedService,
  CreateServiceScheduleRequest,
  CreateServiceScheduleResponse,
  UpdateServiceStatusRequest,
  UpdateServiceStatusResponse,
} from '../types/appointment-sync.types';

import { SSOError } from '../types/errors/sso-error';
import { RequestContext } from '../context/request-context';

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

  private buildHeaders(context: RequestContext): Record<string, string> {

    return {
      'X-Correlation-Id': context.correlationId,
      Authorization: `Bearer ${context.serviceToken}`,
    };
  }

  async fetchSchedules(
    payload: FetchSchedulesRequest,
    context: RequestContext,
  ): Promise<Schedule[]> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.client.post<{ data: Schedule[] }>(
        '/fetch/schedules',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      return response.data.data ?? [];

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
    context: RequestContext,
  ): Promise<AvailableService[]> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.packageServiceClient.post<GetAvailableServicesResponse>(
        '/services/get-available-services',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      return response.data.data ?? [];

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
    context: RequestContext,
  ): Promise<RecommendedService[]> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.packageServiceClient.post<RecommendServicesResponse>(
        '/services/recommend-services',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      return response.data.data ?? [];

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
    context: RequestContext,
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

      if (!response.data.data) {
        throw new Error('No schedule data returned from create service schedule');
      }

      return response.data.data;

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
    context: RequestContext,
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
}

let scheduleServiceClientInstance: ScheduleServiceClient | null = null;

export function getScheduleServiceClient(): ScheduleServiceClient {

  if (!scheduleServiceClientInstance) {
    scheduleServiceClientInstance = new ScheduleServiceClient();
  }

  return scheduleServiceClientInstance;
}