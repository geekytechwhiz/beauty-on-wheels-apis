import axios, { AxiosError, AxiosInstance } from 'axios';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { getEnvConfig } from '../config/env';
import {
  RoleAssignment,
  RoleAssignmentPayload,
  SSOError,
  ServiceClientConfig,
} from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class RoleServiceClient {
  private readonly client: AxiosInstance;
  private readonly logger = createChildLogger(baseLogger, { component: 'RoleServiceClient' });

  constructor(config?: ServiceClientConfig) {
    const envConfig = getEnvConfig();
    const baseUrl = config?.baseUrl || envConfig.ROLE_SERVICE_BASE_URL;
    const apiKey = config?.apiKey || envConfig.ROLE_SERVICE_INTERNAL_API_KEY;
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
          event: 'role_service_request_error',
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  async ensureRoleAssignment(
    payload: RoleAssignmentPayload,
    correlationId: string
  ): Promise<RoleAssignment> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'role_assignment_start',
      userId: payload.userId,
      roleCode: payload.roleCode,
    });

    try {
      const response = await this.client.post<{ data: RoleAssignment }>(
        '/internal/user-role-assignments',
        {
          user_id: payload.userId,
          role_code: payload.roleCode,
        },
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        }
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'role_assignment_success',
        durationMs: duration,
        assignmentId: response.data.data.id,
      });

      return response.data.data;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 409) {
          logger.info({
            event: 'role_assignment_already_exists',
            durationMs: duration,
            userId: payload.userId,
            roleCode: payload.roleCode,
          });
          return {
            id: 'existing',
            userId: payload.userId,
            roleCode: payload.roleCode,
            assignedAt: new Date().toISOString(),
          };
        }

        logger.error({
          event: 'role_assignment_error',
          durationMs: duration,
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.roleServiceError(
          `Role assignment failed: ${axiosError.message}`,
          axiosError
        );
      }

      logger.error({
        event: 'role_assignment_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      throw SSOError.roleServiceError(
        'Unexpected error during role assignment',
        error as Error
      );
    }
  }

  async getUserRoles(
    userId: string,
    correlationId: string
  ): Promise<RoleAssignment[]> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'get_user_roles_start',
      userId,
    });

    try {
      const response = await this.client.get<{ data: RoleAssignment[] }>(
        `/internal/users/${userId}/roles`,
        {
          headers: {
            'X-Correlation-Id': correlationId,
          },
        }
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'get_user_roles_success',
        durationMs: duration,
        roleCount: response.data.data.length,
      });

      return response.data.data;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 404) {
          logger.info({
            event: 'get_user_roles_not_found',
            durationMs: duration,
            userId,
          });
          return [];
        }

        logger.error({
          event: 'get_user_roles_error',
          durationMs: duration,
          status: axiosError.response?.status,
          err: serializeError(axiosError),
        });

        throw SSOError.roleServiceError(
          `Get user roles failed: ${axiosError.message}`,
          axiosError
        );
      }

      logger.error({
        event: 'get_user_roles_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      throw SSOError.roleServiceError(
        'Unexpected error fetching user roles',
        error as Error
      );
    }
  }
}

let roleServiceClientInstance: RoleServiceClient | null = null;

export function getRoleServiceClient(): RoleServiceClient {
  if (!roleServiceClientInstance) {
    roleServiceClientInstance = new RoleServiceClient();
  }
  return roleServiceClientInstance;
}
