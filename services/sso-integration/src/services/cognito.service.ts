import {
  createChildLogger,
  createLogger,
  serializeError,
} from '@api-hub/logger';

import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
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

  private readonly logger = createChildLogger(baseLogger, {
    component: 'CognitoService',
  });

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
  }

  /**
   * Find user by email
   * First attempts AdminGetUser (fast)
   * Falls back to ListUsers if username != email
   */
  async findUserByEmail(
    email: string,
  ): Promise<TruTechVerifiedPayload | null> {
    try {
      this.logger.debug({
        event: 'cognito_find_user_by_email_start',
        email,
      });

      const cmd = new ListUsersCommand({
        UserPoolId: this.userPoolId!,
        Filter: `email = "${email}"`,
        Limit: 1,
      });

      const res = await this.client.send(cmd);

      const user = res.Users?.[0];

      if (!user) {
        this.logger.info({
          event: 'cognito_find_user_by_email_not_found',
          email,
        });

        return null;
      }

      const mapped = this.mapUser(user);

      this.logger.info({
        event: 'cognito_find_user_by_email_success',
        email,
        hasDoctorUid: !!mapped.doctorUid,
        hasTenantId: !!mapped.tenantId,
        hasOrganizationId: !!mapped.organizationId,
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
   * Fetch specific user attributes using AdminGetUser
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
        hasUserID: !!result.userID,
        hasOrganizationID: !!result.organizationID,
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
 
  private mapUser(user: any): TruTechVerifiedPayload {
    const attributes = Object.fromEntries(
      (user.Attributes || []).map((a: any) => [a.Name, a.Value]),
    );

    return {
      email: attributes.email,
      // Prefer dedicated doctorUid attribute if present, otherwise fall back to legacy custom:userID
      doctorUid: attributes['custom:doctorUid'] || attributes['custom:userID'],
      // Support both camelCase and legacy organizationID attribute names
      organizationId:
        attributes['custom:organizationId'] || attributes['custom:organizationID'],
      doctorId: attributes['custom:doctorId'],
      tenantSubdomain: attributes['custom:tenantSubdomain'],
      // Fall back to primary email if dedicated doctorEmail is not set
      doctorEmail: attributes['custom:doctorEmail'] || attributes.email,
      tenantId: attributes['custom:tenantId'],
    } as TruTechVerifiedPayload;
  }
} 