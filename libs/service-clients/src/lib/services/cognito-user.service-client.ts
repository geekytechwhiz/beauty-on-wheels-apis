import { CognitoService } from './cognito.service';
import { UserAlreadyExistsError } from '../utils/errors';
import { serializeError } from '@api-hub/observability';

export interface CognitoUserInput {
  email?: string;
  phoneNumber?: string;
  phoneCode?: string;
  username?: string;
  userType?: string;
  userID?: string;
  organizationID: string;
  roleName?: string;
  permissions?: string[];

  /** External/SSO metadata for Cognito custom attributes */
  providerId?: string;
  externalUserId?: string;
  subdomain?: string;
  /**
   * External organization identifier (e.g. HMS tenant/org id) to be
   * stored as custom:organizationId in Cognito, in addition to the
   * internal numeric organizationID.
   */
  organizationExternalId?: string;
  /**
   * Logical role label for Cognito (e.g. "doctor", "patient").
   * When not provided, the caller can derive it from userType/definedRoleCode.
   */
  role?: string;
}

export interface CognitoUserResult {
  username: string
  email?: string
  phoneNumber?: string
}

export class CognitoUserService {

  private cognito: CognitoService;

  constructor() {
    this.cognito = new CognitoService(
      process.env.DEFAULT_AWS_REGION || 'us-east-1',
      process.env.COGNITO_USER_POOL_ID || '',
    );
  }

  async createUser(
    input: CognitoUserInput,
    logger: any,
  ): Promise<CognitoUserResult | null> {

    const email = input.email?.trim().toLowerCase();
    const phone = this.normalizePhone(input.phoneNumber, input.phoneCode);

    if (!email && !phone) {
      return null;
    }

    await this.ensureUserDoesNotExist(email, phone);

    const username =
      input.username?.trim() ||
      email ||
      phone;

    if (!username) {
      return null;
    }

    try {

      await this.cognito.createUser(username, {
        email,
        phoneNumber: phone,
        customAttributes: {
          userType: String(input.userType || ''),
          userID: String(input.userID || ''),
          organizationID: input.organizationID,
          // organizationId: input.organizationExternalId ?? input.organizationID,
          role: input.role,
          roleName: input.roleName ?? '',
          permissions: JSON.stringify(input.permissions || []),
          // providerId: input.providerId,
          // externalUserId: input.externalUserId,
          // subdomain: input.subdomain,
        },
      });

      logger.info({
        event: 'cognito_user_created',
        username,
        email,
        phone,
      });

      return {
        username,
        email,
        phoneNumber: phone,
      };

    } catch (err) {

      logger.error({
        event: 'cognito_user_creation_failed',
        err: serializeError(err),
      });

      throw err;
    }
  }

  private async ensureUserDoesNotExist(
    email?: string,
    phone?: string,
  ) {

    if (email) {
      const exists = await this.cognito.userExistsIdentifier(email);
      if (exists) {
        throw new UserAlreadyExistsError(email);
      }
    }

    if (phone) {
      const exists = await this.cognito.userExistsIdentifier(phone);
      if (exists) {
        throw new UserAlreadyExistsError(phone);
      }
    }

  }

  private normalizePhone(
    phone?: string,
    phoneCode?: string,
  ): string | undefined {

    if (!phone) return undefined;

    const p = String(phone).trim();
    const code = String(phoneCode || '').trim();

    const combined = code ? `${code}${p}` : p;

    return combined.startsWith('+')
      ? combined
      : `+${combined}`;
  }

}