import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { CreateUserPayload, ServiceClientConfig, UserLookupParams } from '../types/appointment.types';
import { SSOError } from '../types/errors/sso-error';
import { DoctorCreationPayload, PatientCreationPayload } from '../types/user-creation.types';
import {
  User,
} from '../types/user/user.types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class UserServiceClient {
  private readonly client: AxiosInstance;
  private readonly logger = createChildLogger(baseLogger, { component: 'UserServiceClient' }); 
  constructor(config?: ServiceClientConfig) { 
    const baseUrl = config?.baseUrl || process.env.USER_SERVICE_BASE_URL;
    
    // Use Bearer token auth instead of internal API key header
    // const token = config?.apiKey || envConfig.USER_SERVICE_INTERNAL_API_KEY;
    // const token = "eyJraWQiOiJrb3JVYlwveXljUmNtY05EaEVNXC9MdFFPZE1MOElOSnJBdUh6MTU3TU5LMlE9IiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiI5YzlkOGQzNS1hOTI4LTQzNzEtOTI3ZS02OWM1ZDg5ZDQ1NGIiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaXNzIjoiaHR0cHM6XC9cL2NvZ25pdG8taWRwLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tXC91cy1lYXN0LTFfQUsxSFR4ZGxYIiwicGhvbmVfbnVtYmVyX3ZlcmlmaWVkIjp0cnVlLCJjb2duaXRvOnVzZXJuYW1lIjoiOWM5ZDhkMzUtYTkyOC00MzcxLTkyN2UtNjljNWQ4OWQ0NTRiIiwiY3VzdG9tOm9yZ2FuaXphdGlvbklEIjoibW0xdXNnZTMzZDRmOWI2MSIsImN1c3RvbTp1c2VySUQiOiIwMUtKQTNFOVE3SE1RWEFQWVpUQzg1OTcyQiIsImN1c3RvbTp1c2VyVHlwZSI6IlNUQUZGIiwiYXVkIjoiNnY2OHIyc3R0OWI0cmdyM3U4MzQ4YnNsc2kiLCJldmVudF9pZCI6ImQ0N2IxMzRiLWVkODUtNDNjMi05NzZhLTllZjljZWQyODc0NyIsInRva2VuX3VzZSI6ImlkIiwiY3VzdG9tOnNyYyI6InRydWV0ZWNoYWRtaW5AeW9wbWFpbC5jb20iLCJhdXRoX3RpbWUiOjE3NzIwMzQxMzMsInBob25lX251bWJlciI6Iis5MTk4OTA5MDk4MDkiLCJleHAiOjE3NzIwMzUwMzMsImN1c3RvbTpwZXJtaXNzaW9ucyI6IltdIiwiY3VzdG9tOnJvbGUiOiJbXCI3MTZmN2Q0Yi0yOGM0LTRiYWEtYWZjMS0yODQyMWE2ZDI2MDhcIl0iLCJpYXQiOjE3NzIwMzQxMzMsImVtYWlsIjoidHJ1ZXRlY2hhZG1pbkB5b3BtYWlsLmNvbSJ9.h6NmMyV37-JzyRqwvwhGr86zLiVaZeDtNur1ZSiy0RgdkCS-OUj6va5wygVY_iCPor7BZxKGyjHQfAOW7laOVs18WQASBfR_jioMmwtQiCGrCANsXGXlozEjGks4UXc-Ks1RyH1BStkOJtbCHRpFxJhThZzB3kbcx5WNNYll2b-6MjlxMCkmK7A2vzQDbSmpgoXUMfAXD48wydmWej1mX047AkCI75ZG4YBXYE1up-pL32Nz0tr5cRdlhfTHCHoAe8Po1myezfl1rAq02RiZnlYd0xuSukVO_S8Cm8R5OZl3Qr0OTsYBZJp0VJ7F2PItu58J-QQ5UvGRAkmyXkNLQQ"
    const timeout = config?.timeoutMs || 10000;

    this.client = axios.create({
      baseURL: baseUrl,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        // Matches Postman setup: Authorization: Bearer <token>
        // Authorization: `Bearer ${token}`,
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
      tenantId: "mm1usge33d4f9b61",
    });
    console.log("FIND BY ID :",this.client)
    try {
      const response = await this.client.post<{ data: User }>(`/users/validateusers`, {
        params: {
          provider: params.provider,
          externalId: params.externalId,
          tenant_id: params.tenantId,
        },
        headers: {
          'X-Correlation-Id': correlationId,
        },
      });
      console.log("RESPONSE USER: ", response.data);
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
    config: {
      token: string;
      correlationId: string;
    }
  ): Promise<User> {
    const logger = createChildLogger(this.logger, { correlationId: config.correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'doctor_create_start',
      provider: doctorPayload.provider,  
      subDomain: doctorPayload.subDomain,
      doctorName: doctorPayload.userInfo.name,
    });
    console.log("DOCTOR PAYLOAD : ",doctorPayload)
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
