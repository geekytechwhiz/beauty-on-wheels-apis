import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import axios, { AxiosError } from 'axios';

import { UserLookupParams } from '../types/appointment.types';
import { DoctorCreationPayload, PatientCreationPayload } from '../types/user-creation.types';
import { User } from '../types/user/user.types';
import { SSOError } from '../types/errors/sso-error';

import { RequestContext } from '../context/request-context';
import { UserServiceClient } from '@api-hub/service-clients';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class SSOUserServiceClient extends UserServiceClient {

  constructor(authHeader?: string) {
    super(authHeader as string);
  }

  private buildHeaders(context: RequestContext): Record<string, string> {
    return {
      'X-Correlation-Id': context.correlationId,
      Authorization: `Bearer ${context.serviceToken}`,
    };
  }

  async  findByExternalId(
    params: UserLookupParams,
    context: RequestContext
  ): Promise<User | null> {

    const logger = createChildLogger(baseLogger, {
      correlationId: context.correlationId,
    });

    const startTime = Date.now();

    logger.info({
      event: 'user_lookup_start',
      provider: params.provider,
      tenantId: params.tenantId,
      externalId: params.externalId,
    });

    try {

      const response = await this.client.post<{ data: User }>(
        '/users/validateusers',
        {
          provider: params.provider,
          externalId: params.externalId,
          tenant_id: params.tenantId,
        },
        {
          headers: this.buildHeaders(context),
        }
      );

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
            externalId: params.externalId,
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
          `User lookup failed: ${axiosError.message}`,
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
    context: RequestContext
  ): Promise<User> {

    const logger = createChildLogger(baseLogger, {
      correlationId: context.correlationId,
    });

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
          headers: this.buildHeaders(context),
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
    context: RequestContext
  ): Promise<User> {

    const logger = createChildLogger(baseLogger, {
      correlationId: context.correlationId,
    });

    const startTime = Date.now();

    logger.info({
      event: 'doctor_create_start',
      provider: doctorPayload.provider,
      subDomain: doctorPayload.subDomain,
      doctorName: doctorPayload.userInfo.name,
    });

    try {

      const response = await this.client.post<{ data: User }>(
        '/user',
        {
          ...doctorPayload,
        },
        {
          headers: this.buildHeaders(context),
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
    context: RequestContext
  ): Promise<User> {

    const logger = createChildLogger(baseLogger, {
      correlationId: context.correlationId,
    });

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
          headers: this.buildHeaders(context),
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

let instance: SSOUserServiceClient | null = null;

export function getSSOUserServiceClient(): SSOUserServiceClient {

  if (!instance) {
    instance = new SSOUserServiceClient();
  }

  return instance;
}