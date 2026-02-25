import { createLogger, createChildLogger, serializeError, createPerformanceTimer } from '@api-hub/logger';
import { getHMSAdapter } from './hms.adapter';
import { getUserServiceClient } from './user.client';
import { getRoleServiceClient } from './role.client';
import { getCognitoService } from './cognito.service';
import {
  CognitoTokens,
  SSOError,
  SSOLaunchResponse,
  User,
  HMSVerifiedPayload,
} from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

const HMS_PROVIDER = 'HMS';
const HMS_DOCTOR_ROLE = 'ROLE_HMS_DOCTOR';
const SSO_SOURCE = 'SSO_HMS';

export interface LaunchResult {
  tokens: CognitoTokens;
  user: {
    id: string;
    externalId: string;
    provider: string;
    tenantId: string;
    doctorId: number;
  };
}

export class LaunchService {
  private readonly logger = createChildLogger(baseLogger, { component: 'LaunchService' });
  private readonly hmsAdapter = getHMSAdapter();
  private readonly userClient = getUserServiceClient();
  private readonly roleClient = getRoleServiceClient();
  private readonly cognitoService = getCognitoService();

  async processLaunch(
    launchToken: string,
    correlationId: string
  ): Promise<LaunchResult> {
    const logger = createChildLogger(this.logger, { correlationId });
    const timer = createPerformanceTimer(logger, 'launch_flow');

    logger.info({
      event: 'launch_flow_start',
      tokenLength: launchToken.length,
    });

    try {
      const hmsPayload = await this.verifyToken(launchToken, correlationId);

      const user = await this.resolveUser(hmsPayload, correlationId);

      this.validateUserStatus(user, correlationId);

      await this.ensureRoleAssignment(user.id, correlationId);

      const tokens = await this.authenticateUser(user, correlationId);

      timer.end();

      logger.info({
        event: 'launch_flow_success',
        userId: user.id,
        tenantId: user.tenantId,
      });

      return {
        tokens,
        user: {
          id: user.id,
          externalId: user.externalId,
          provider: user.provider,
          tenantId: user.tenantId,
          doctorId: hmsPayload.doctorId,
        },
      };
    } catch (error) {
      timer.end();

      if (error instanceof SSOError) {
        logger.warn({
          event: 'launch_flow_error',
          errorCode: error.code,
          statusCode: error.statusCode,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'launch_flow_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'An unexpected error occurred during SSO launch',
        error as Error
      );
    }
  }

  private async verifyToken(
    launchToken: string,
    correlationId: string
  ): Promise<HMSVerifiedPayload> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({ event: 'step_verify_token_start' });

    const payload = await this.hmsAdapter.verifyLaunchToken(launchToken, correlationId);

    logger.info({
      event: 'step_verify_token_complete',
      tenantId: payload.tenantId,
    });

    return payload;
  }

  private async resolveUser(
    hmsPayload: HMSVerifiedPayload,
    correlationId: string
  ): Promise<User> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({
      event: 'step_resolve_user_start',
      tenantId: hmsPayload.tenantId,
    });

    let user = await this.userClient.findByExternalId(
      {
        provider: HMS_PROVIDER,
        externalId: hmsPayload.doctorUid,
        tenantId: hmsPayload.tenantId,
      },
      correlationId
    );

    if (!user) {
      logger.info({
        event: 'user_not_found_creating',
        tenantId: hmsPayload.tenantId,
      });

      user = await this.userClient.createUser(
        {
          externalId: hmsPayload.doctorUid,
          provider: HMS_PROVIDER,
          tenantId: hmsPayload.tenantId,
          role: 'DOCTOR',
          source: SSO_SOURCE,
          email: hmsPayload.doctorEmail,
          phone: hmsPayload.doctorPhone,
          firstName: hmsPayload.doctorName?.split(' ')[0],
          lastName: hmsPayload.doctorName?.split(' ').slice(1).join(' '),
        },
        correlationId
      );

      logger.info({
        event: 'user_created',
        userId: user.id,
      });
    } else {
      logger.info({
        event: 'user_found',
        userId: user.id,
        userStatus: user.status,
      });
    }

    return user;
  }

  private validateUserStatus(user: User, correlationId: string): void {
    const logger = createChildLogger(this.logger, { correlationId });

    if (user.status === 'INACTIVE') {
      logger.warn({
        event: 'user_inactive',
        userId: user.id,
        status: user.status,
      });
      throw SSOError.userInactive('User account is inactive');
    }

    if (user.status === 'PENDING') {
      logger.info({
        event: 'user_pending_allowed',
        userId: user.id,
        status: user.status,
      });
    }

    logger.debug({
      event: 'user_status_valid',
      userId: user.id,
      status: user.status,
    });
  }

  private async ensureRoleAssignment(
    userId: string,
    correlationId: string
  ): Promise<void> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({
      event: 'step_ensure_role_start',
      userId,
      roleCode: HMS_DOCTOR_ROLE,
    });

    await this.roleClient.ensureRoleAssignment(
      {
        userId,
        roleCode: HMS_DOCTOR_ROLE,
      },
      correlationId
    );

    logger.info({
      event: 'step_ensure_role_complete',
      userId,
      roleCode: HMS_DOCTOR_ROLE,
    });
  }

  private async authenticateUser(
    user: User,
    correlationId: string
  ): Promise<CognitoTokens> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({
      event: 'step_cognito_auth_start',
      userId: user.id,
    });

    const tokens = await this.cognitoService.authenticateUser(user, correlationId);

    logger.info({
      event: 'step_cognito_auth_complete',
      userId: user.id,
      hasTokens: !!tokens.accessToken,
    });

    return tokens;
  }

  formatResponse(result: LaunchResult): SSOLaunchResponse {
    return {
      success: true,
      data: {
        tokens: result.tokens,
        user: result.user,
      },
    };
  }
}

let launchServiceInstance: LaunchService | null = null;

export function getLaunchService(): LaunchService {
  if (!launchServiceInstance) {
    launchServiceInstance = new LaunchService();
  }
  return launchServiceInstance;
}
