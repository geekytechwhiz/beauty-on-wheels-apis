import axios, { AxiosError, AxiosInstance } from 'axios';
import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';

import { getEnvConfig } from '../config/env';
import {
  FetchSchedulesRequest,
  Schedule,
  ScheduleCreateRequest,
  ScheduleStatusUpdateRequest,
} from '../types/appointment-sync.types';

import { SSOError } from '../types/errors/sso-error';
import { RequestContext } from '../context/request-context';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class ScheduleServiceClient {

  private readonly client: AxiosInstance;

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

  async createSchedule(
    payload: ScheduleCreateRequest,
    context: RequestContext,
  ): Promise<Schedule> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.client.post<{ data: Schedule }>(
        '/create/schedule',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      return response.data.data;

    } catch (error) {

      if (axios.isAxiosError(error)) {

        const axiosError = error as AxiosError;

        logger.error({
          event: 'schedule_create_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        if (axiosError.response?.status === 409) {
          throw SSOError.downstreamError('Schedule already exists', axiosError);
        }

        throw SSOError.downstreamError(
          `Schedule creation failed: ${axiosError.message}`,
          axiosError,
        );
      }

      logger.error({
        event: 'schedule_create_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Unexpected error during schedule creation',
        error as Error,
      );
    }
  }

  async updateScheduleStatus(
    payload: ScheduleStatusUpdateRequest,
    context: RequestContext,
  ): Promise<Schedule> {

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
    });

    try {

      const response = await this.client.post<{ data: Schedule }>(
        '/update/schedule-status',
        payload,
        {
          headers: this.buildHeaders(context),
        },
      );

      return response.data.data;

    } catch (error) {

      if (axios.isAxiosError(error)) {

        const axiosError = error as AxiosError;

        logger.error({
          event: 'schedule_update_status_error',
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.downstreamError(
          `Schedule status update failed: ${axiosError.message}`,
          axiosError,
        );
      }

      logger.error({
        event: 'schedule_update_status_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.downstreamError(
        'Unexpected error during schedule status update',
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