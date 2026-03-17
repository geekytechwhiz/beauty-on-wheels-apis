import {
  createChildLogger,
  createLogger,
  serializeError,
} from '@api-hub/logger';

import {
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

import {    CognitoUserContext, CognitoUserClaims } from '../types/user/user.types';
import { cognitoPhone } from '@api-hub/utils';

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

  private async findCognitoUserByFilter(
    filter: string,
    logContext: Record<string, unknown>,
  ): Promise<CognitoUserContext | null> {
    try {
      const cmd = new ListUsersCommand({
        UserPoolId: this.userPoolId!,
        Filter: filter,
        Limit: 1,
      });

      const res = await this.client.send(cmd);

      if (!res.Users || res.Users.length === 0) {
        this.logger.info({
          event: 'cognito_find_user_by_filter_not_found',
          ...logContext,
        });

        return null;
      }

      const user = res.Users[0];
      const claims = Object.fromEntries(
        (user.Attributes || []).map((a) => [a.Name, a.Value]),
      ) as unknown as CognitoUserClaims;
      const mapped = this.mapCognitoClaimsToAuthContext(claims);

      this.logger.info({
        event: 'cognito_find_user_by_filter_success',
        cognitoUsername: user.Username,
        ...logContext,
      });

      return mapped;
    } catch (err: any) {
      if (
        err.name === 'ResourceNotFoundException' ||
        err.message === 'ResourceNotFoundException'
      ) {
        this.logger.info({
          event: 'cognito_find_user_by_filter_not_found',
          ...logContext,
        });
        return null;
      }

      this.logger.error({
        event: 'cognito_lookup_error',
        err: serializeError(err),
        ...logContext,
      });

      return null;
    }
  }

 
  /**
   * Find user by email
   */
  async findCognitoUserByEmail(
    email: string | null | undefined,
  ): Promise<CognitoUserContext | null> {
  
    try {
  
      if (!email || typeof email !== 'string') {
        this.logger.warn({
          event: 'cognito_find_user_by_email_invalid_input',
          email,
        });
        return null;
      }
  
      const rawEmail = email.trim().toLowerCase();
  
      if (!rawEmail.includes('@')) {
        this.logger.warn({
          event: 'cognito_email_invalid_format',
          email: rawEmail,
        });
        return null;
      }
  
      const normalizedEmail = rawEmail;
  
      this.logger.debug({
        event: 'cognito_find_user_by_email_start',
        originalEmail: rawEmail,
        lookupEmail: normalizedEmail,
      });
  
      return this.findCognitoUserByFilter(`email = "${normalizedEmail}"`, {
        email: normalizedEmail,
      });
  
    } catch (err: any) {

      if (
        err.name === 'ResourceNotFoundException' ||
        err.message === 'ResourceNotFoundException'
      ) {
    
        this.logger.info({
          event: 'cognito_find_user_by_email_not_found',
          email
        });
    
        return null;
      }
    
      this.logger.error({
        event: 'cognito_lookup_error',
        email,
        err: serializeError(err),
      });
    
      return null;
    }
  }

  async findCognitoUserByPhone(
    phone: string | null | undefined,
  ): Promise<CognitoUserContext | null> {
  
    try {
  
      if (!phone || typeof phone !== 'string') {
        this.logger.warn({
          event: 'cognito_find_user_by_phone_invalid_input',
          phone,
        });
        return null;
      }
  
      const rawPhone = phone.trim();
  
      const cognitoPhoneNumber = cognitoPhone(rawPhone, 'ZA');
  
      if (!cognitoPhoneNumber) {
        this.logger.warn({
          event: 'cognito_phone_invalid',
          phone: rawPhone
        });
        return null;
      }
  
      this.logger.debug({
        event: 'cognito_find_user_by_phone_start',
        originalPhone: rawPhone,
        lookupPhone: cognitoPhoneNumber,
      });
  
      return this.findCognitoUserByFilter(
        `phone_number = "${cognitoPhoneNumber}"`,
        { phone: cognitoPhoneNumber },
      );
  
    } catch (err: any) {
  
      if (err.name === 'ResourceNotFoundException' || err.message === 'ResourceNotFoundException') {
  
        this.logger.info({
          event: 'cognito_find_user_by_phone_not_found',
          phone
        }); 
        return null;
      }
  
      this.logger.error({
        event: 'cognito_lookup_error',
        phone,
        err: serializeError(err),
      });
  
      return null;
    }
  }

  async findCognitoUserByEmailOrPhone(params: {
    email?: string | null;
    phone?: string | null;
  }): Promise<CognitoUserContext | null> {
    const cognitoUserByEmail = await this.findCognitoUserByEmail(params.email);

    if (cognitoUserByEmail) {
      return cognitoUserByEmail;
    }

    return this.findCognitoUserByPhone(params.phone);
  }
  /**
   * Find user by phone
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
   * Generate JWT token from Cognito for a specific user.
   * For SSO launch, we authenticate using a shared password.
   */
  async generateToken(username: string, _role?: string) {
    try {
      console.log("USERNAME: ", username);
      console.log("ROLE: ", _role);
      const authUsername = username.trim();
      const authPassword =
        process.env.COGNITO_SSO_COMMON_PASSWORD || 'Comm@n123';

      this.logger.info({
        event: 'cognito_generate_token_start',
        username: authUsername,
      });
  
      const cmd = new AdminInitiateAuthCommand({
        UserPoolId: this.userPoolId!,
        ClientId: this.clientId!,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: {
          USERNAME: authUsername,
          PASSWORD: authPassword,
        },
      });

      const res = await this.client.send(cmd);
      const auth = res.AuthenticationResult;

      this.logger.info({
        event: 'cognito_generate_token_success',
        username: authUsername,
      });

      return {
        accessToken: auth?.AccessToken,    // Cognito AccessToken
        updateToken: auth?.IdToken,        // Cognito IdToken
        refreshToken: auth?.RefreshToken,  // Cognito RefreshToken
        expiresIn: auth?.ExpiresIn,
      };
    } catch (err) {
      this.logger.error({
        event: 'cognito_generate_token_failed',
        username,
        err: serializeError(err),
      });

      // throw err;
      return null;
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

      const result:any= await this.generateToken(username, password);

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
  private mapCognitoClaimsToAuthContext(claims: CognitoUserClaims): CognitoUserContext {
    return {
      principalId: claims["custom:userID"],
  
      userId: claims["custom:id"],

      organizationId: claims["custom:organizationID"],
      userType: claims["custom:userType"],
      email: claims.email,
      phone: claims.phone_number,
      roles: claims["custom:role"]
        ? JSON.parse(claims["custom:role"])
        : [],
  
      permissions: claims["custom:permissions"]
        ? JSON.parse(claims["custom:permissions"])
        : [],
   
        externalUserId: claims["custom:externalUserId"],
        providerId: claims["custom:providerId"],
        subdomain: claims["custom:subdomain"],
        
      authType: "USER",
    };
  }
}
 