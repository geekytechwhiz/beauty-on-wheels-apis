import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';

import { getEnvConfig } from '../config/env';
import { 
    TruTechAppointmentsResponse,
    TruTechPatientEMRResponse,
    TruTechVerifyResponse
} from '../types/appointment.types';
import { SSOError } from '../types/errors/sso-error';
import { DUMMY_APPOINTMENTS_RESPONSE } from '../data/dummy-appointments.data';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true
});

export class TruTechClient {

  private readonly client: AxiosInstance;

  private readonly logger = createChildLogger(baseLogger, {
    component: 'TruTechClient'
  });

  constructor() {

    const config = getEnvConfig();

    this.client = axios.create({
      baseURL: config.TRU_TECH_BASE_URL,
      timeout: config.TRU_TECH_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.TRU_TECH_API_KEY}`,
        token: config.TRU_TECH_API_KEY
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {

    this.client.interceptors.request.use((request) => {

      this.logger.debug({
        event: 'trutech_request_start',
        method: request.method?.toUpperCase(),
        url: request.url
      });

      return request;

    });

    this.client.interceptors.response.use(

      (response) => {

        this.logger.debug({
          event: 'trutech_request_complete',
          status: response.status,
          url: response.config.url
        });

        return response;

      },

      (error: AxiosError) => {

        this.logger.error({
          event: 'trutech_request_error',
          status: error.response?.status,
          url: error.config?.url,
          message: error.message
        });

        return Promise.reject(error);

      }

    );

  }

  async verifyLaunchToken(
    launchToken: string,
    correlationId: string
  ): Promise<TruTechVerifyResponse> {

    const logger = createChildLogger(this.logger, { correlationId });

    try {

      const response = await this.client.post<TruTechVerifyResponse>(
        '/api/teleconsultation/verify',
        { launch_token: launchToken },
        {
          headers: {
            'X-Correlation-Id': correlationId
          }
        }
      );

      return response.data;

    } catch (error) {

      this.handleAxiosError(error, 'verify_launch_token', logger);

    }
  }

  async getTodaysAppointments(
    doctorId: number,
    correlationId: string
  ): Promise<TruTechAppointmentsResponse> {

    const logger = createChildLogger(this.logger, {
      correlationId,
      doctorId
    });

    try {

      const response = await this.client.post<TruTechAppointmentsResponse>(
        '/api/teleconsultation/todays-appointments',
        { doctor_id: doctorId },
        {
          headers: {
            'X-Correlation-Id': correlationId
          }
        }
      );

      // For testing: return dummy data if appointments array is empty (143-152)
      if (!response.data.appointments || response.data.appointments.length === 0) {
        logger.info({
          event: 'using_dummy_appointments_data',
          doctorId,
          reason: 'empty_appointments_array'
        });

        return DUMMY_APPOINTMENTS_RESPONSE;
      }

      return response.data;

    } catch (error) {

      this.handleAxiosError(error, 'get_todays_appointments', logger);

    }
  }

  
  async getPatientEMRSummary(
    patientId: number,
    correlationId: string
  ): Promise<TruTechPatientEMRResponse> {

    const logger = createChildLogger(this.logger, {
      correlationId,
      patientId
    });

    try {

      const response = await this.client.post<TruTechPatientEMRResponse>(
        '/api/teleconsultation/patient-emr-summary',
        { patient_id: patientId },
        {
          headers: {
            'X-Correlation-Id': correlationId
          }
        }
      );

      return response.data;

    } catch (error) {

      this.handleAxiosError(error, 'get_patient_emr_summary', logger);

    }
  }


  private handleAxiosError(
    error: unknown,
    operation: string,
    logger: ReturnType<typeof createChildLogger>
  ): never {

    if (axios.isAxiosError(error)) {

      const axiosError = error as AxiosError;

      logger.error({
        event: `${operation}_error`,
        status: axiosError.response?.status,
        code: axiosError.code,
        err: serializeError(axiosError)
      });

      if (
        axiosError.code === 'ECONNABORTED' ||
        axiosError.code === 'ETIMEDOUT'
      ) {
        throw SSOError.downstreamError(
          'TruTech request timed out',
          axiosError
        );
      }

      if (axiosError.response?.status === 401) {
        throw SSOError.unauthorized(
          'TruTech API key invalid or missing'
        );
      }

      if (axiosError.response?.status === 404) {
        throw SSOError.notFound(
          'Resource not found in TruTech'
        );
      }

      if (axiosError.response?.status &&
          axiosError.response.status >= 500) {

        throw SSOError.truTechServiceError(
          'TruTech service unavailable',
          axiosError
        );
      }

      throw SSOError.truTechServiceError(
        `TruTech request failed: ${axiosError.message}`,
        axiosError
      );
    }

    logger.error({
      event: `${operation}_unexpected_error`,
      err: serializeError(error as Error)
    });

    throw SSOError.internalError(
      `Unexpected error during ${operation}`,
      error as Error
    );
  }

}

let truTechClientInstance: TruTechClient | null = null;

export function getTruTechClient(): TruTechClient {

  if (!truTechClientInstance) {
    truTechClientInstance = new TruTechClient();
  }

  return truTechClientInstance;

}