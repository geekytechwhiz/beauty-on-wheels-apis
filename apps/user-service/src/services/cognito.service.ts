import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
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
        Username: identifier,
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
          const filter = isEmail ? `email = "${identifier}"` : `phone_number = "${identifier}"`;
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
   * Create a new user in Cognito User Pool
   * @param email - User email address
   * @throws Error if user creation fails
   */
  /**
   * Create a new user in Cognito User Pool
   * @param identifier - Username to use in Cognito (email or phone)
   * @param options - optional attributes to set (email, phoneNumber)
   */
  async createUser(identifier: string, options?: { email?: string; phoneNumber?: string }): Promise<void> {
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
      if (options?.email) {
        attrs.push({ Name: 'email', Value: String(options.email) });
        attrs.push({ Name: 'email_verified', Value: 'true' });
      }
      if (options?.phoneNumber) {
        attrs.push({ Name: 'phone_number', Value: String(options.phoneNumber) });
        attrs.push({ Name: 'phone_number_verified', Value: 'true' });
      }

      // If no explicit attributes passed, attempt to infer email from identifier
      if (attrs.length === 0 && String(identifier).includes('@')) {
        attrs.push({ Name: 'email', Value: identifier });
        attrs.push({ Name: 'email_verified', Value: 'true' });
      }

      const cmd = new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: identifier,
        UserAttributes: attrs,
        MessageAction: 'SUPPRESS', // Suppress welcome email
      });
      await this.client.send(cmd);
      logger.info({
        event: 'cognito_user_created',
        identifier,
        userPoolId: this.userPoolId,
        message: 'User created successfully in Cognito',
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
