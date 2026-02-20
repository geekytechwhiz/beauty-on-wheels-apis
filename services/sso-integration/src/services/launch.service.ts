/**
 * Launch Service - Verifies HMS launch tokens; ensures user exists via user-service; issues Cognito tokens
 *
 * Flow:
 * 1. Verify launch_token (JWT or HMS /verify)
 * 2. Extract doctor_uid, tenant_id (e.g. hmsId)
 * 3. GET user-service /internal/users/by-external-id (provider, external_id, tenant_id)
 * 4. If 404 → POST user-service /internal/users (external_id, provider, tenant_id, role, source)
 * 5. Cognito AdminInitiateAuth (SSO does not create Cognito users; user-service does)
 * 6. Return id_token, access_token, refresh_token, doctor_uid to handler
 */

import * as jwt from 'jsonwebtoken';
import { HMSClientService } from './hms-client.service';
import { TokenService } from './token.service';
import { CognitoService } from './cognito.service';
import { UserServiceClient } from '../clients/user-service.client';
import { logger } from '../utils/logger';
import { LaunchTokenPayload, SessionTokenPayload } from '../types';
import { IHMSLaunchProvider } from '../providers/hms-launch.provider';
import { JWTLaunchProvider } from '../providers/jwt-launch.provider';
import { getConfig } from '../config';

/** Result of processLaunch when Cognito is configured: Cognito tokens + doctor_uid */
export interface LaunchResultWithCognito {
  doctor_uid: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  userId: string;
  hmsId: string;
  clientId: string;
  sessionToken?: string;
}

/** Legacy result when Cognito is not configured (sessionToken only) */
export interface LaunchResultLegacy {
  sessionToken: string;
  userId: string;
  hmsId: string;
  clientId: string;
}

export type ProcessLaunchResult = LaunchResultWithCognito | LaunchResultLegacy;

export function isLaunchResultWithCognito(r: ProcessLaunchResult): r is LaunchResultWithCognito {
  return 'id_token' in r && 'doctor_uid' in r;
}

export class LaunchService {
  private hmsClientService: HMSClientService;
  private tokenService: TokenService;
  private cognitoService: CognitoService;
  private userServiceClient: UserServiceClient;
  private launchProvider: IHMSLaunchProvider;

  constructor(
    hmsClientService?: HMSClientService,
    tokenService?: TokenService,
    cognitoService?: CognitoService,
    userServiceClient?: UserServiceClient,
    launchProvider?: IHMSLaunchProvider
  ) {
    this.hmsClientService = hmsClientService || new HMSClientService();
    this.tokenService = tokenService || new TokenService();
    this.cognitoService = cognitoService || new CognitoService();
    this.userServiceClient = userServiceClient || new UserServiceClient();
    this.launchProvider = launchProvider || new JWTLaunchProvider(this.hmsClientService);
  }

  /**
   * Verify launch token from HMS using configured provider
   * Extracts clientId from token and delegates to provider
   */
  async verifyLaunchToken(launchToken: string): Promise<LaunchTokenPayload | null> {
    try {
      // Decode without verify first to get clientId for provider lookup
      const decoded = jwt.decode(launchToken) as Record<string, unknown> | null;
      if (!decoded) {
        logger.warn('Launch token invalid or malformed');
        return null;
      }

      // Support clientId, client_id, or aud (common JWT conventions)
      const clientId =
        (decoded.clientId as string) ||
        (decoded.client_id as string) ||
        (decoded.aud as string);
      if (!clientId) {
        logger.warn('Launch token missing clientId (expected clientId, client_id, or aud)', {
          payloadKeys: Object.keys(decoded),
        });
        return null;
      }

      // Verify client exists and is active
      const hmsClient = await this.hmsClientService.getClient(clientId);
      if (!hmsClient || !hmsClient.active) {
        logger.warn('HMS client not found or inactive', { clientId });
        return null;
      }

      // Delegate to provider for token verification
      // Future: could select provider based on client.providerType config
      const payload = await this.launchProvider.verifyLaunchToken(launchToken, clientId);
      
      if (payload) {
        logger.info('Launch token verified', {
          clientId,
          provider: this.launchProvider.getProviderType(),
        });
      }
      
      return payload;
    } catch (error) {
      logger.warn('Launch token verification failed', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Create JWT session from verified launch token payload
   */
  createSession(launchPayload: LaunchTokenPayload): string {
    const sessionId = require('crypto').randomBytes(16).toString('hex');
    const scope = launchPayload.permissions || launchPayload.roles || ['user:read'];

    const payload: Omit<SessionTokenPayload, 'iat' | 'exp' | 'jti'> = {
      sub: launchPayload.sub,
      hmsId: launchPayload.hmsId,
      clientId: launchPayload.clientId,
      sessionId,
      email: launchPayload.email,
      name: launchPayload.name,
      scope,
      iss: process.env.APP_ISSUER || getConfig().appIssuer,
      aud: 'myvitalrx-app',
    };

    const sessionToken = this.tokenService.generateSessionToken(payload);
    logger.info('Session created', {
      userId: launchPayload.sub,
      hmsId: launchPayload.hmsId,
      clientId: launchPayload.clientId,
    });

    return sessionToken;
  }

  /**
   * Full launch flow:
   * 1. Verify launch_token; get doctor_uid, tenant_id (hmsId)
   * 2. user-service: GET by-external-id; if 404, POST create SSO user
   * 3. Cognito AdminInitiateAuth (user created by user-service, not SSO)
   * 4. Return tokens + doctor_uid
   *
   * When Cognito + user-service are configured: full flow. Otherwise legacy sessionToken only.
   */
  async processLaunch(launchToken: string): Promise<ProcessLaunchResult | null> {
    const payload = await this.verifyLaunchToken(launchToken);
    if (!payload) return null;

    const doctor_uid = payload.sub;
    const userId = payload.sub;
    const hmsId = payload.hmsId;
    const clientId = payload.clientId;
    const tenant_id = payload.hmsId;

    if (this.cognitoService.isConfigured() && this.userServiceClient.isConfigured()) {
      let user = await this.userServiceClient.getByExternalId({
        provider: 'HMS',
        external_id: doctor_uid,
        tenant_id,
      });
      if (!user) {
        try {
          user = await this.userServiceClient.createSsoUser({
            external_id: doctor_uid,
            provider: 'HMS',
            tenant_id,
            role: 'DOCTOR',
            source: 'SSO_HMS',
          });
        } catch (err) {
          logger.error('User-service create SSO user failed', err as Error, {
            doctor_uid,
            tenant_id,
          });
          throw err;
        }
      }
      const tokens = await this.cognitoService.authenticateUser(doctor_uid);
      const result: LaunchResultWithCognito = {
        doctor_uid,
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        userId: user?.userID ?? doctor_uid,
        hmsId,
        clientId,
      };
      logger.info('SSO launch with Cognito tokens', { doctor_uid, hmsId, clientId });
      return result;
    }

    const sessionToken = this.createSession(payload);
    logger.info('SSO launch (legacy session token)', { userId, hmsId, clientId });
    return {
      sessionToken,
      userId,
      hmsId,
      clientId,
    };
  }
}
