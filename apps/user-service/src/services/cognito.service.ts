import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
  UserNotFoundException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { createLogger, serializeError } from '@api-hub/logger';

const logger = createLogger({ service: 'cognito-service' });

export class CognitoService {
  private client: CognitoIdentityProviderClient;
  private userPoolId: string;

  constructor(region: string, userPoolId: string) {
    if (!userPoolId) {
      logger.warn({
        event: 'cognito_service_init_missing_pool_id',
        message: 'Cognito User Pool ID is not configured. Cognito operations will be skipped.',
      });
    }
    this.client = new CognitoIdentityProviderClient({ region });
    this.userPoolId = userPoolId;
  }

  /**
   * Check if a user exists in Cognito User Pool
   * @param email - User email address
   * @returns true if user exists, false otherwise
   */
  /**
   * Check if an identifier (email or phone or username) exists in Cognito User Pool
   * Tries AdminGetUser by username, then falls back to ListUsers with attribute filter
   */
  async userExistsIdentifier(identifier: string): Promise<boolean> {
    if (!this.userPoolId) {
      logger.debug({
        event: 'cognito_user_exists_skipped',
        identifier,
        message: 'Cognito User Pool ID not configured, skipping user existence check',
      });
      return false;
    }

    try {
      // Try by username first
      const cmd = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: String(identifier).toLowerCase(),
      });
      await this.client.send(cmd);
      logger.debug({
        event: 'cognito_user_exists_found_by_username',
        identifier,
        userPoolId: this.userPoolId,
      });
      return true;
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        // Not found as username — fall back to attribute search using ListUsers
        try {
          const isEmail = String(identifier).includes('@');
          const searchIdentifier = isEmail ? String(identifier).toLowerCase() : identifier;
          const filter = isEmail ? `email = "${searchIdentifier}"` : `phone_number = "${searchIdentifier}"`;
          const listCmd = new ListUsersCommand({ UserPoolId: this.userPoolId, Filter: filter, Limit: 1 });
          const res = await this.client.send(listCmd);
          const found = !!(res && (res as any).Users && (res as any).Users.length > 0);
          logger.debug({
            event: 'cognito_user_exists_checked_list',
            identifier,
            userPoolId: this.userPoolId,
            found,
          });
          return found;
        } catch (err2) {
          logger.warn({
            event: 'cognito_user_exists_list_error',
            identifier,
            userPoolId: this.userPoolId,
            err: serializeError(err2),
            message: 'Error while searching Cognito users by attribute',
          });
          // On unexpected errors, return false to keep behavior tolerant like before
          return false;
        }
      }

      // Log unexpected errors but don't throw - return false to allow fallback behavior
      logger.warn({
        event: 'cognito_user_exists_error',
        identifier,
        userPoolId: this.userPoolId,
        err: serializeError(err),
        message: 'Unexpected error checking user existence in Cognito',
      });
      return false;
    }
  }

  // Backwards compatible method name
  async userExists(email: string): Promise<boolean> {
    return this.userExistsIdentifier(email);
  }

  /**
   * Get custom user attributes (userID, organizationID) from Cognito User Pool by username (e.g. JWT sub).
   * Used when authorizer or JWT claims do not provide these (e.g. for searchFnF).
   */
  async getUserAttributes(username: string): Promise<{ userID?: string; organizationID?: string }> {
    if (!this.userPoolId) {
      logger.debug({
        event: 'cognito_get_user_attrs_skipped',
        message: 'Cognito User Pool ID not configured',
      });
      return {};
    }
    try {
      const cmd = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      });
      const res = await this.client.send(cmd);
      const attrs = res.UserAttributes ?? [];
      const getAttr = (name: string) => attrs.find((a) => a.Name === name)?.Value;
      return {
        userID: getAttr('custom:userID') ?? undefined,
        organizationID: getAttr('custom:organizationID') ?? undefined,
      };
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        logger.debug({ event: 'cognito_get_user_attrs_not_found', username });
        return {};
      }
      logger.warn({
        event: 'cognito_get_user_attrs_error',
        username,
        userPoolId: this.userPoolId,
        err: serializeError(err),
        message: 'Failed to get user attributes from Cognito',
      });
      return {};
    }
  }

  /**
   * Create a new user in Cognito User Pool
   * @param email - User email address
   * @throws Error if user creation fails
   */
  /**
   * Create a new user in Cognito User Pool
   * @param identifier - Username to use in Cognito (email or phone)
   * @param options - optional attributes to set (email, phoneNumber, customAttributes)
   */
  async createUser(
    identifier: string,
    options?: {
      email?: string;
      phoneNumber?: string;
      customAttributes?: {
        userType?: string;
        userID?: string;
        organizationID?: string;
        /**
         * External organization identifier (e.g. HMS tenant/org id).
         * Stored separately from internal numeric organizationID.
         */
        organizationId?: string;
        role?: string;
        permissions?: string;
        provider?: string;
        externalUserId?: string;
        subdomain?: string;
      };
    }
  ): Promise<void> {
    if (!this.userPoolId) {
      const error = new Error('Cognito User Pool ID is not configured');
      logger.error({
        event: 'cognito_create_user_failed',
        identifier,
        err: serializeError(error),
        message: 'Cannot create user in Cognito: User Pool ID not configured',
      });
      throw error;
    }

    try {
      const attrs: Array<{ Name: string; Value: string }> = [];
      const isEmail = String(identifier).includes('@');      
      if (options?.email) {
        attrs.push({ Name: 'email', Value: String(options.email) });
        attrs.push({ Name: 'email_verified', Value: 'true' });
      }
      if (options?.phoneNumber) {
        attrs.push({ Name: 'phone_number', Value: String(options.phoneNumber) });
        attrs.push({ Name: 'phone_number_verified', Value: 'true' });
      }

      // If no explicit attributes passed, attempt to infer email from identifier
      if (attrs.length === 0 && isEmail) {
        attrs.push({ Name: 'email', Value: identifier });
        attrs.push({ Name: 'email_verified', Value: 'true' });
      }

      // Add custom attributes matching old implementation
      if (options?.customAttributes) {
        const custom = options.customAttributes;
        if (custom.userType) attrs.push({ Name: 'custom:userType', Value: String(custom.userType) });
        if (custom.userID) attrs.push({ Name: 'custom:userID', Value: String(custom.userID) });
        if (custom.organizationID) attrs.push({ Name: 'custom:organizationID', Value: String(custom.organizationID) });
        if (custom.organizationId) attrs.push({ Name: 'custom:organizationId', Value: String(custom.organizationId) });
        if (custom.role) attrs.push({ Name: 'custom:role', Value: String(custom.role) });
        if (custom.permissions) attrs.push({ Name: 'custom:permissions', Value: String(custom.permissions) });
        if (custom.provider) attrs.push({ Name: 'custom:providerId', Value: String(custom.provider) });
        if (custom.externalUserId) attrs.push({ Name: 'custom:externalUserId', Value: String(custom.externalUserId) });
        if (custom.subdomain) attrs.push({ Name: 'custom:subdomain', Value: String(custom.subdomain) });
        attrs.push({ Name: 'custom:src', Value: isEmail ? String(identifier).toLowerCase() : String(identifier) });
      }

      const usernameForCognito = String(identifier).toLowerCase();
      
      // Generate password
      const generatePassword = (): string => {
        return `Comm@n123`;
      };
      
      const temporaryPassword = generatePassword();
      const cmd = new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: usernameForCognito,
        UserAttributes: attrs,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: temporaryPassword,
      });
      await this.client.send(cmd);
      
      const setPasswordCmd = new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: usernameForCognito,
        Password: generatePassword(),
        Permanent: true,
      });
      await this.client.send(setPasswordCmd);
      
      logger.info({
        event: 'cognito_user_created',
        identifier,
        userPoolId: this.userPoolId,
        message: 'User created successfully in Cognito with CONFIRMED status',
      });
    } catch (err) {
      if (err instanceof UsernameExistsException) {
        logger.info({
          event: 'cognito_user_already_exists',
          identifier,
          userPoolId: this.userPoolId,
          message: 'User already exists in Cognito, skipping creation',
        });
        // User already exists, this is not an error - just return
        return;
      }
      logger.error({
        event: 'cognito_create_user_error',
        identifier,
        userPoolId: this.userPoolId,
        err: serializeError(err),
        message: 'Failed to create user in Cognito',
      });
      throw err;
    }
  }
}
