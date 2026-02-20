import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AuthFlowType,
  MessageActionType,
  UserNotFoundException,
  NotAuthorizedException,
  InvalidPasswordException,
  UserNotConfirmedException,
} from '@aws-sdk/client-cognito-identity-provider';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { getEnvConfig } from '../config/env';
import { CognitoTokens, SSOError, User } from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class CognitoService {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly clientId: string;
  private readonly logger = createChildLogger(baseLogger, { component: 'CognitoService' });

  constructor() {
    const config = getEnvConfig();
    this.userPoolId = config.COGNITO_USER_POOL_ID;
    this.clientId = config.COGNITO_CLIENT_ID;

    this.client = new CognitoIdentityProviderClient({
      region: this.userPoolId.split('_')[0],
    });
  }

  async authenticateUser(
    user: User,
    correlationId: string
  ): Promise<CognitoTokens> {
    const logger = createChildLogger(this.logger, { correlationId, userId: user.id });
    const startTime = Date.now();

    logger.info({
      event: 'cognito_auth_start',
      tenantId: user.tenantId,
      provider: user.provider,
    });

    try {
      const cognitoUsername = await this.ensureCognitoUser(user, correlationId);
      const tempPassword = this.generateSecurePassword();

      await this.setUserPassword(cognitoUsername, tempPassword, correlationId);

      const authResult = await this.adminInitiateAuth(
        cognitoUsername,
        tempPassword,
        correlationId
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'cognito_auth_success',
        durationMs: duration,
        cognitoUsername,
      });

      return authResult;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SSOError) {
        throw error;
      }

      logger.error({
        event: 'cognito_auth_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      throw SSOError.cognitoAuthError(
        'Cognito authentication failed',
        error as Error
      );
    }
  }

  private async ensureCognitoUser(
    user: User,
    correlationId: string
  ): Promise<string> {
    const logger = createChildLogger(this.logger, { correlationId });
    const cognitoUsername = user.cognitoUsername || `sso_${user.provider.toLowerCase()}_${user.externalId}`;

    try {
      await this.client.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: cognitoUsername,
        })
      );

      logger.debug({
        event: 'cognito_user_exists',
        cognitoUsername,
      });

      await this.updateUserAttributes(cognitoUsername, user, correlationId);

      return cognitoUsername;
    } catch (error) {
      if (error instanceof UserNotFoundException) {
        logger.info({
          event: 'cognito_user_not_found_creating',
          cognitoUsername,
        });
        return this.createCognitoUser(cognitoUsername, user, correlationId);
      }
      throw error;
    }
  }

  private async createCognitoUser(
    cognitoUsername: string,
    user: User,
    correlationId: string
  ): Promise<string> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    logger.info({
      event: 'cognito_create_user_start',
      cognitoUsername,
      provider: user.provider,
      tenantId: user.tenantId,
    });

    try {
      const userAttributes = [
        { Name: 'custom:external_id', Value: user.externalId },
        { Name: 'custom:provider', Value: user.provider },
        { Name: 'custom:tenant_id', Value: user.tenantId },
        { Name: 'custom:user_id', Value: user.id },
      ];

      if (user.email) {
        userAttributes.push(
          { Name: 'email', Value: user.email },
          { Name: 'email_verified', Value: 'true' }
        );
      }

      if (user.phone) {
        userAttributes.push(
          { Name: 'phone_number', Value: user.phone },
          { Name: 'phone_number_verified', Value: 'true' }
        );
      }

      if (user.firstName || user.lastName) {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        userAttributes.push({ Name: 'name', Value: fullName });
      }

      await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: cognitoUsername,
          UserAttributes: userAttributes,
          MessageAction: MessageActionType.SUPPRESS,
        })
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'cognito_create_user_success',
        durationMs: duration,
        cognitoUsername,
      });

      return cognitoUsername;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error({
        event: 'cognito_create_user_error',
        durationMs: duration,
        cognitoUsername,
        err: serializeError(error as Error),
      });

      throw error;
    }
  }

  private async updateUserAttributes(
    cognitoUsername: string,
    user: User,
    correlationId: string
  ): Promise<void> {
    const logger = createChildLogger(this.logger, { correlationId });

    try {
      const userAttributes = [
        { Name: 'custom:tenant_id', Value: user.tenantId },
        { Name: 'custom:user_id', Value: user.id },
      ];

      await this.client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: cognitoUsername,
          UserAttributes: userAttributes,
        })
      );

      logger.debug({
        event: 'cognito_update_attributes_success',
        cognitoUsername,
      });
    } catch (error) {
      logger.warn({
        event: 'cognito_update_attributes_error',
        cognitoUsername,
        err: serializeError(error as Error),
      });
    }
  }

  private async setUserPassword(
    cognitoUsername: string,
    password: string,
    correlationId: string
  ): Promise<void> {
    const logger = createChildLogger(this.logger, { correlationId });

    try {
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: cognitoUsername,
          Password: password,
          Permanent: true,
        })
      );

      logger.debug({
        event: 'cognito_set_password_success',
        cognitoUsername,
      });
    } catch (error) {
      if (error instanceof InvalidPasswordException) {
        logger.error({
          event: 'cognito_set_password_invalid',
          cognitoUsername,
          err: serializeError(error),
        });
        throw SSOError.cognitoAuthError('Failed to set user password', error);
      }
      throw error;
    }
  }

  private async adminInitiateAuth(
    cognitoUsername: string,
    password: string,
    correlationId: string
  ): Promise<CognitoTokens> {
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    try {
      const response = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
          AuthParameters: {
            USERNAME: cognitoUsername,
            PASSWORD: password,
          },
        })
      );

      const duration = Date.now() - startTime;

      if (!response.AuthenticationResult) {
        logger.error({
          event: 'cognito_auth_no_result',
          durationMs: duration,
          cognitoUsername,
          challengeName: response.ChallengeName,
        });
        throw SSOError.cognitoAuthError('Authentication did not return tokens');
      }

      const { AuthenticationResult } = response;

      logger.info({
        event: 'cognito_admin_auth_success',
        durationMs: duration,
        cognitoUsername,
        hasAccessToken: !!AuthenticationResult.AccessToken,
        hasIdToken: !!AuthenticationResult.IdToken,
        hasRefreshToken: !!AuthenticationResult.RefreshToken,
      });

      return {
        accessToken: AuthenticationResult.AccessToken!,
        idToken: AuthenticationResult.IdToken!,
        refreshToken: AuthenticationResult.RefreshToken!,
        expiresIn: AuthenticationResult.ExpiresIn || 3600,
        tokenType: AuthenticationResult.TokenType || 'Bearer',
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof NotAuthorizedException) {
        logger.error({
          event: 'cognito_auth_not_authorized',
          durationMs: duration,
          cognitoUsername,
        });
        throw SSOError.cognitoAuthError('Authentication not authorized', error);
      }

      if (error instanceof UserNotConfirmedException) {
        logger.error({
          event: 'cognito_auth_user_not_confirmed',
          durationMs: duration,
          cognitoUsername,
        });
        throw SSOError.cognitoAuthError('User not confirmed', error);
      }

      if (error instanceof SSOError) {
        throw error;
      }

      logger.error({
        event: 'cognito_admin_auth_error',
        durationMs: duration,
        cognitoUsername,
        err: serializeError(error as Error),
      });

      throw error;
    }
  }

  private generateSecurePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const length = 32;
    let password = '';

    password += 'A';
    password += 'a';
    password += '0';
    password += '!';

    for (let i = 4; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  }
}

let cognitoServiceInstance: CognitoService | null = null;

export function getCognitoService(): CognitoService {
  if (!cognitoServiceInstance) {
    cognitoServiceInstance = new CognitoService();
  }
  return cognitoServiceInstance;
}
