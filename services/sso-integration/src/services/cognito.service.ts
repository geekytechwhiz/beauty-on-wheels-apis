import {
  createChildLogger,
  createLogger,
  serializeError,
} from '@api-hub/logger';

import {
  AdminGetUserCommand, 
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  ListUsersCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

import { TruTechVerifiedPayload } from '../types/appointment.types';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class CognitoService {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId = process.env.COGNITO_USER_POOL_ID;
  private readonly clientId = process.env.COGNITO_CLIENT_ID;

  private readonly logger = createChildLogger(baseLogger, {
    component: 'CognitoService',
  });

  // token cache
  private cachedToken?: {
    accessToken: string;
    expiry: number;
  };

  constructor() {
    this.client = new CognitoIdentityProviderClient({
      region: process.env.DEFAULT_AWS_REGION,
    });

    if (!this.userPoolId) {
      this.logger.error({
        event: 'cognito_service_init_missing_pool_id',
      });
      throw new Error('COGNITO_USER_POOL_ID not configured');
    }

    if (!this.clientId) {
      this.logger.error({
        event: 'cognito_service_init_missing_client_id',
      });
      throw new Error('COGNITO_CLIENT_ID not configured');
    }
  }

  /**
   * Find user by email
   */
  async findUserByEmail(
    email: string,
  ): Promise<TruTechVerifiedPayload | null> {
    try {
      const normalizedEmail = email.trim().toLowerCase();
  
      this.logger.debug({
        event: 'cognito_find_user_by_email_start',
        email: normalizedEmail,
      });
  
      const cmd = new ListUsersCommand({
        UserPoolId: this.userPoolId!,
        Filter: `email = "${normalizedEmail}"`,
        Limit: 1,
      });
  
      const res = await this.client.send(cmd);
  
      if (!res.Users || res.Users.length === 0) {
        this.logger.info({
          event: 'cognito_find_user_by_email_not_found',
          email: normalizedEmail,
        });
  
        return null;
      }
  
      const user = res.Users[0];
  
      const mapped = this.mapUser(user);
  
      this.logger.info({
        event: 'cognito_find_user_by_email_success',
        email: normalizedEmail,
        cognitoUsername: user.Username,
      });
  
      return mapped;
    } catch (err) {
      this.logger.error({
        event: 'cognito_user_lookup_failed',
        email,
        err: serializeError(err),
      });
  
      throw err;
    }
  }

  /**
   * Fetch specific user attributes
   */
  async getUserAttributes(
    username: string,
  ): Promise<{ userID?: string; organizationID?: string }> {
    try {
      this.logger.debug({
        event: 'cognito_get_user_attrs_start',
        username,
      });

      const cmd = new AdminGetUserCommand({
        UserPoolId: this.userPoolId!,
        Username: username,
      });

      const res = await this.client.send(cmd);

      const attrs = res.UserAttributes ?? [];

      const getAttr = (name: string) =>
        attrs.find((a) => a.Name === name)?.Value;

      const result = {
        userID: getAttr('custom:userID') ?? undefined,
        organizationID: getAttr('custom:organizationID') ?? undefined,
      };

      this.logger.info({
        event: 'cognito_get_user_attrs_success',
        username,
      });

      return result;
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        this.logger.debug({
          event: 'cognito_user_not_found',
          username,
        });
        return {};
      }

      this.logger.warn({
        event: 'cognito_get_user_attrs_error',
        username,
        err: serializeError(err),
      });

      return {};
    }
  }

  /**
   * Set permanent password for a user
   */
  async setPassword(username: string, password: string): Promise<void> {
    try {
      this.logger.info({
        event: 'cognito_set_password_start',
        username,
      });

      const cmd = new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId!,
        Username: username,
        Password: password,
        Permanent: true,
      });

      await this.client.send(cmd);

      this.logger.info({
        event: 'cognito_set_password_success',
        username,
      });
    } catch (err) {
      this.logger.error({
        event: 'cognito_set_password_failed',
        username,
        err: serializeError(err),
      });

      throw err;
    }
  }

  /**
   * Generate JWT token from Cognito
   */
  async generateToken(username: string, password: string) {
    try {
      this.logger.info({
        event: 'cognito_generate_token_start', 
      });
  
      const temporaryUsername = 'rootadmin@yopmail.com';
      const temporaryPassword = 'common@2026';
      
      const cmd = new InitiateAuthCommand({
        ClientId: this.clientId!,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: {
          USERNAME: temporaryUsername,
          PASSWORD: temporaryPassword,
        },
      });

      const res = await this.client.send(cmd);
      console.log(res);
      const auth = res.AuthenticationResult;
      console.log(auth);

      this.logger.info({
        event: 'cognito_generate_token_success',
        username,
      });

      return {
        accessToken: auth?.AccessToken,
        idToken: auth?.IdToken,
        refreshToken: auth?.RefreshToken,
        expiresIn: auth?.ExpiresIn,
      };
    } catch (err) {
      this.logger.error({
        event: 'cognito_generate_token_failed',
        username,
        err: serializeError(err),
      });

      throw err;
    }
  }

  /**
   * Get cached token for service-to-service calls
   */
  async getServiceToken(
    username: string,
    password: string,
  ): Promise<string> {
    try {
      const now = Date.now();

      if (this.cachedToken && this.cachedToken.expiry > now) {
        this.logger.debug({
          event: 'cognito_token_cache_hit',
        });

        return this.cachedToken.accessToken;
      }

      this.logger.info({
        event: 'cognito_token_cache_miss_generating_new',
      });

      const result = await this.generateToken(username, password);

      if (!result.accessToken) {
        throw new Error('Failed to generate Cognito token');
      }

      const expiresIn = result.expiresIn ?? 3600;

      this.cachedToken = {
        accessToken: result.accessToken,
        expiry: now + (expiresIn - 60) * 1000,
      };

      this.logger.info({
        event: 'cognito_token_cached',
        expiresIn,
      });

      return result.accessToken;
    } catch (err) {
      this.logger.error({
        event: 'cognito_get_service_token_failed',
        err: serializeError(err),
      });

      throw err;
    }
  }

  /**
   * Map Cognito user to payload
     */
  private mapUser(user: any): TruTechVerifiedPayload {
    const attributes = Object.fromEntries(
      (user.Attributes || []).map((a: any) => [a.Name, a.Value]),
    );

    return {
      email: attributes.email,
      doctorUid: attributes['custom:doctorUid'] || attributes['custom:userID'],
      organizationId:
        attributes['custom:organizationId'] ||
        attributes['custom:organizationID'],
      doctorId: attributes['custom:doctorId'],
      tenantSubdomain: attributes['custom:tenantSubdomain'],
      doctorEmail: attributes['custom:doctorEmail'] || attributes.email,
      tenantId: attributes['custom:tenantId'],
    } as TruTechVerifiedPayload;
  }
}