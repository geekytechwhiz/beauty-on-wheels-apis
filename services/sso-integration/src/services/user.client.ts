import axios, { AxiosError, AxiosInstance } from 'axios';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { getEnvConfig } from '../config/env';
import {
  User,
  UserLookupParams,
  CreateUserPayload,
  SSOError,
  ServiceClientConfig,
} from '../types';
import { DoctorCreationPayload, PatientCreationPayload } from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class UserServiceClient {
  private readonly client: AxiosInstance;
  private readonly logger = createChildLogger(baseLogger, { component: 'UserServiceClient' });

  constructor(config?: ServiceClientConfig) {
    const envConfig = getEnvConfig();
    const baseUrl = config?.baseUrl || envConfig.USER_SERVICE_BASE_URL;
    const apiKey = config?.apiKey || envConfig.USER_SERVICE_INTERNAL_API_KEY;
    const timeout = config?.timeoutMs || 10000;

    this.client = axios.create({
      baseURL: baseUrl,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': apiKey,
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        this.logger.error({
          event: 'user_service_request_error',
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  async findByExternalId(
    params: UserLookupParams,
    correlationId: string
  ): Promise<User | null> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'user_lookup_start',
      provider: params.provider,
      tenantId: params.tenantId,
    });

    try {
      const response = await this.client.get<{ data: User }>(`/user/organization/${params.tenantId}/${params.externalId}`, {
        params: {
          provider: params.provider,
          external_id: params.externalId,
          tenant_id: params.tenantId,
        },
        headers: {
          'X-Correlation-Id': correlationId,
        },
      });

      const duration = Date.now() - startTime;

      logger.info({
        event: 'user_lookup_success',
        durationMs: duration,
        userId: response.data.data.id,
        userStatus: response.data.data.status,
      });

      return response.data.data;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 404) {
          logger.info({
            event: 'user_lookup_not_found',
            durationMs: duration,
            provider: params.provider,
            tenantId: params.tenantId,
          });
          return null;
        }

        logger.error({
          event: 'user_lookup_error',
          durationMs: duration,
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.userServiceError(
          `User service lookup failed: ${axiosError.message}`,
          axiosError
        );
      }

      logger.error({
        event: 'user_lookup_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      throw SSOError.userServiceError(
        'Unexpected error during user lookup',
        error as Error
      );
    }
  }

  async createUser(
    payload: CreateUserPayload,
    correlationId: string
  ): Promise<User> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'user_create_start',
      provider: payload.provider,
      tenantId: payload.tenantId,
      role: payload.role,
      source: payload.source,
    });

    try {
      const response = await this.client.post<{ data: User }>(
        '/user',
        {
          external_id: payload.externalId,
          provider: payload.provider,
          tenant_id: payload.tenantId,
          role: payload.role,
          source: payload.source,
          email: payload.email,
          phone: payload.phone,
          first_name: payload.firstName,
          last_name: payload.lastName,
        },
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        }
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'user_create_success',
        durationMs: duration,
        userId: response.data.data.id,
      });

      return response.data.data;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        logger.error({
          event: 'user_create_error',
          durationMs: duration,
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        if (axiosError.response?.status === 409) {
          throw SSOError.userServiceError('User already exists', axiosError);
        }

        throw SSOError.userServiceError(
          `User creation failed: ${axiosError.message}`,
          axiosError
        );
      }

      logger.error({
        event: 'user_create_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      throw SSOError.userServiceError(
        'Unexpected error during user creation',
        error as Error
      );
    }
  }

  /**
   * Creates a doctor user with full doctor structure.
   * This method supports the complete doctor creation payload as per user service API.
   * 
   * @param doctorPayload - Full doctor creation payload
   * @param externalId - External ID from provider (e.g., TruTech doctor_uid)
   * @param provider - Provider name (e.g., "TruTech")
   * @param tenantId - Tenant ID
   * @param correlationId - Correlation ID for logging
   * @returns Created user
   */
  async createDoctor(
    doctorPayload: DoctorCreationPayload,
    externalId: string,
    provider: string,
    tenantId: string,
    correlationId: string,
  ): Promise<User> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'doctor_create_start',
      provider,
      tenantId,
      externalId,
      doctorName: doctorPayload.userInfo.name,
    });

    try {
      const response = await this.client.post<{ data: User }>(
        '/user',
        {
          external_id: externalId,
          provider,
          tenant_id: tenantId,
          ...doctorPayload,
        },
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        }
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'doctor_create_success',
        durationMs: duration,
        userId: response.data.data.id,
      });

      return response.data.data;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        logger.error({
          event: 'doctor_create_error',
          durationMs: duration,
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        if (axiosError.response?.status === 409) {
          throw SSOError.userServiceError('Doctor already exists', axiosError);
        }

        throw SSOError.userServiceError(
          `Doctor creation failed: ${axiosError.message}`,
          axiosError
        );
      }

      logger.error({
        event: 'doctor_create_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      throw SSOError.userServiceError(
        'Unexpected error during doctor creation',
        error as Error
      );
    }
  }

  /**
   * Creates a patient user with full patient structure.
   * This method supports the complete patient creation payload as per user service API.
   * 
   * @param patientPayload - Full patient creation payload
   * @param externalId - External ID from provider (e.g., TruTech patient id)
   * @param provider - Provider name (e.g., "TruTech")
   * @param tenantId - Tenant ID
   * @param correlationId - Correlation ID for logging
   * @returns Created user
   */
  async createPatient(
    patientPayload: PatientCreationPayload,
    externalId: string,
    provider: string,
    tenantId: string,
    correlationId: string,
  ): Promise<User> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'patient_create_start',
      provider,
      tenantId,
      externalId,
      patientName: patientPayload.userInfo.name,
    });

    try {
      const response = await this.client.post<{ data: User }>(
        '/user',
        {
          external_id: externalId,
          provider,
          tenant_id: tenantId,
          ...patientPayload,
        },
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        }
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'patient_create_success',
        durationMs: duration,
        userId: response.data.data.id,
      });

      return response.data.data;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        logger.error({
          event: 'patient_create_error',
          durationMs: duration,
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        if (axiosError.response?.status === 409) {
          throw SSOError.userServiceError('Patient already exists', axiosError);
        }

        throw SSOError.userServiceError(
          `Patient creation failed: ${axiosError.message}`,
          axiosError
        );
      }

      logger.error({
        event: 'patient_create_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      throw SSOError.userServiceError(
        'Unexpected error during patient creation',
        error as Error
      );
    }
  }
}

let userServiceClientInstance: UserServiceClient | null = null;

export function getUserServiceClient(): UserServiceClient {
  if (!userServiceClientInstance) {
    userServiceClientInstance = new UserServiceClient();
  }
  return userServiceClientInstance;
}
