/**
 * Cognito Service — Authentication only (no user creation)
 *
 * SSO does NOT create users in Cognito. user-service owns Cognito user creation.
 * This service only performs AdminInitiateAuth to obtain id_token, access_token, refresh_token
 * after the application user is guaranteed to exist (via user-service).
 */

import * as crypto from 'crypto';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { logger } from '../utils/logger';
import { getConfig } from '../config';

/** Cognito tokens returned after AdminInitiateAuth */
export interface CognitoTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Derives the SSO password for AdminInitiateAuth (must match user-service derivation).
 * Min 8 chars, 1 upper, 1 lower, 1 number, 1 special.
 */
function deriveSsoPassword(doctorUid: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(doctorUid).digest('base64url');
  const safe = hmac.replace(/[^a-zA-Z0-9]/g, 'a').slice(0, 6);
  return `Pwd${safe}1!`;
}

/**
 * SECRET_HASH for Cognito confidential client: base64(HmacSHA256(clientSecret, username + clientId))
 */
function computeSecretHash(username: string, clientId: string, clientSecret: string): string {
  return crypto.createHmac('sha256', clientSecret).update(username + clientId).digest('base64');
}

export class CognitoService {
  private client: CognitoIdentityProviderClient;
  private userPoolId: string;
  private clientId: string;
  private clientSecret: string;
  private passwordSecret: string;

  constructor() {
    const config = getConfig();
    this.userPoolId = config.cognitoUserPoolId;
    this.clientId = config.cognitoClientId;
    this.clientSecret = config.cognitoClientSecret;
    this.passwordSecret = config.cognitoSsoPasswordSecret;
    this.client = new CognitoIdentityProviderClient({ region: config.cognitoRegion });
  }

  isConfigured(): boolean {
    return !!(
      this.userPoolId &&
      this.clientId &&
      this.clientSecret &&
      this.passwordSecret
    );
  }

  /**
   * Authenticate user with AdminInitiateAuth (ADMIN_USER_PASSWORD_AUTH).
   * Call only after user-service has ensured the user exists (and created Cognito user if needed).
   */
  async authenticateUser(doctorUid: string): Promise<CognitoTokens> {
    const password = deriveSsoPassword(doctorUid, this.passwordSecret);
    const secretHash = computeSecretHash(doctorUid, this.clientId, this.clientSecret);

    const response = await this.client.send(
      new AdminInitiateAuthCommand({
        UserPoolId: this.userPoolId,
        ClientId: this.clientId,
        AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
        AuthParameters: {
          USERNAME: doctorUid,
          PASSWORD: password,
          SECRET_HASH: secretHash,
        },
      })
    );

    const result = response.AuthenticationResult;
    if (!result?.IdToken || !result.AccessToken || !result.RefreshToken) {
      logger.error('Cognito AdminInitiateAuth missing tokens', { doctorUid });
      throw new Error('Cognito authentication did not return tokens');
    }

    return {
      id_token: result.IdToken,
      access_token: result.AccessToken,
      refresh_token: result.RefreshToken,
      expires_in: result.ExpiresIn ?? 3600,
    };
  }
}
