import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import axios, { AxiosError } from 'axios';

import { UserLookupParams } from '../types/appointment.types';
import { DoctorCreationPayload, PatientCreationPayload } from '../types/user-creation.types';
import { User } from '../types/user/user.types';
import { SSOError } from '../types/errors/sso-error';

import { RequestContext } from '../context/request-context';
import { UserServiceClient } from '@api-hub/service-clients';
import {
  ExternalIdentity,
  IntegrationMetadata,
  UserSourceSystem,
} from '../types/integration.types';
import { CognitoService } from '../services/cognito.service';
import { getEnvConfig } from '../config/env';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class SSOUserServiceClient extends UserServiceClient {

  constructor(authHeader?: string) {
    super(authHeader as string);
  }

  private buildHeaders(context: RequestContext): Record<string, string> {
    const config = getEnvConfig();
    return {
      'X-Correlation-Id': context.correlationId,
      Authorization: `Bearer ${config.INTERNAL_SERVICE_TOKEN}`,
    };
  }

  private buildExternalIdentity(
    integration: IntegrationMetadata | undefined,
    externalUserId: string,
  ): ExternalIdentity | undefined {
    if (!integration) return undefined;

    return {
      providerId: integration.providerId,
      externalUserId,
    };
  }

  private getSourceSystem(context: RequestContext): UserSourceSystem | undefined {
    return context.sourceSystem;
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
      console.log("user_lookup_success response", JSON.stringify(response.data.data));
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

  async findByExternalIdentity(
    providerId: string,
    externalUserId: string,
    tenantId: string,
    context: RequestContext,
  ): Promise<User | null> {
    return this.findByExternalId(
      {
        provider: providerId,
        externalId: externalUserId,
        tenantId,
      },
      context,
    );
  }

  async findOrCreateUserFromExternalIdentity(
    params: {
      integration?: IntegrationMetadata;
      externalUserId: string;
      tenantId: string;
      email?: string;
      createUser: () => Promise<User>;
    },
    context: RequestContext,
  ): Promise<User> {
    const { integration, externalUserId, tenantId, email, createUser } = params;

    const providerId =
      integration?.providerId ??
      context.integration?.providerId ??
      'TruTech';

    const existingByExternal = await this.findByExternalIdentity(
      providerId,
      externalUserId,
      tenantId,
      context,
    );

    if (existingByExternal) {
      return existingByExternal;
    }

    if (email) {
      const cognito = new CognitoService();
      const cognitoUser = await cognito.findUserByEmail(email);

      if (cognitoUser) {
        // If user already exists in Cognito, skip creation
        const logger = createChildLogger(baseLogger, {
          correlationId: context.correlationId,
        });

        logger.info({
          event: 'user_creation_skipped_cognito_exists',
          email,
        });

        // Caller can decide how to handle "exists in Cognito but not in user service"
        return existingByExternal as User | null as unknown as User;
      }
    }

    return createUser();
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
          ...(this.buildExternalIdentity(context.integration, payload.externalId) && {
            externalIdentity: this.buildExternalIdentity(
              context.integration,
              payload.externalId,
            ),
          }),
          ...(this.getSourceSystem(context) && {
            sourceSystem: this.getSourceSystem(context),
          }),
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
          ...(this.buildExternalIdentity(context.integration, doctorPayload.externalId) && {
            externalIdentity: this.buildExternalIdentity(
              context.integration,
              doctorPayload.externalId,
            ),
          }),
          ...(this.getSourceSystem(context) && {
            sourceSystem: this.getSourceSystem(context),
          }),
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
          ...(this.buildExternalIdentity(context.integration, externalId) && {
            externalIdentity: this.buildExternalIdentity(
              context.integration,
              externalId,
            ),
          }),
          ...(this.getSourceSystem(context) && {
            sourceSystem: this.getSourceSystem(context),
          }),
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