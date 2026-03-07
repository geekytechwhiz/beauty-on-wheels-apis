import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import axios, { AxiosError } from 'axios';
import { CreateUserPayload,  UserLookupParams } from '../types/appointment.types';
import { SSOError } from '../types/errors/sso-error';
import { DoctorCreationPayload, PatientCreationPayload } from '../types/user-creation.types';
import {
  User,
} from '../types/user/user.types'; 
import { UserServiceClient } from '@api-hub/service-clients';
const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class SSOUserServiceClient extends UserServiceClient {
    constructor(authHeader?: string) { 
    super(authHeader as string); 
  }

  async findByExternalId(
    params: UserLookupParams,
    correlationId: string,
    token: string
  ): Promise<User | null> {
    const logger = createChildLogger(baseLogger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'user_lookup_start',
      provider: params.provider,
      tenantId: params.tenantId,
    });

    const headers: Record<string, string> = {
      'X-Correlation-Id': correlationId,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await this.client.post<{ data: User }>(`/users/validateusers`, {
        provider: params.provider,
        externalId: params.externalId,
        tenant_id: params.tenantId,
      }, {
        headers,
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
    payload: DoctorCreationPayload,
    correlationId: string,
    token?: string
  ): Promise<User> {
    const logger = createChildLogger(baseLogger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'user_create_start',
      provider: payload.provider,
      tenantId: payload.tenantId,
      role: payload.role,
      source: payload.source,
    });

    const headers: Record<string, string> = {
      'X-Correlation-Id': correlationId,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

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
          headers,
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

   
  async createDoctor(
    doctorPayload: DoctorCreationPayload,  
    config: {
      token?: string;
      correlationId: string;
    }
  ): Promise<User> {
    const logger = createChildLogger(baseLogger, { correlationId: config.correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'doctor_create_start',
      provider: doctorPayload.provider,  
      subDomain: doctorPayload.subDomain,
      doctorName: doctorPayload.userInfo.name,
    });
    console.log("DOCTOR PAYLOAD : ",doctorPayload)
    console.log("CONFIG TOKEN : ",config.token)
    try {
      
      const response = await this.client.post<{ data: User }>(
        '/user',
        { 
          ...doctorPayload,
        },
        {
          headers: {
            'X-Correlation-Id': config.correlationId,
            'Authorization': `Bearer ${config.token}`,
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

   
  async createPatient(
    patientPayload: PatientCreationPayload,
    externalId: string,
    provider: string,
    tenantId: string,
    correlationId: string,
    token?: string,
  ): Promise<User> {
    const logger = createChildLogger(baseLogger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'patient_create_start',
      provider,
      tenantId,
      externalId,
      patientName: patientPayload.userInfo.name,
    });

    const headers: Record<string, string> = {
      'X-Correlation-Id': correlationId,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

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
          headers,
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

let ssoUserServiceClientInstance: SSOUserServiceClient | null = null;

export function getSSOUserServiceClient(): SSOUserServiceClient {
  if (!ssoUserServiceClientInstance) {
    ssoUserServiceClientInstance = new SSOUserServiceClient();
  }
  return ssoUserServiceClientInstance;
}
