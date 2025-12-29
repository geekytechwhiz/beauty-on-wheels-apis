import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
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
  async userExists(email: string): Promise<boolean> {
    if (!this.userPoolId) {
      logger.debug({
        event: 'cognito_user_exists_skipped',
        email,
        message: 'Cognito User Pool ID not configured, skipping user existence check',
      });
      return false;
    }

    try {
      const cmd = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
      });
      await this.client.send(cmd);
      logger.debug({
        event: 'cognito_user_exists_found',
        email,
        userPoolId: this.userPoolId,
      });
      return true;
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        logger.debug({
          event: 'cognito_user_exists_not_found',
          email,
          userPoolId: this.userPoolId,
        });
        return false;
      }
      // Log unexpected errors but don't throw - return false to allow fallback behavior
      logger.warn({
        event: 'cognito_user_exists_error',
        email,
        userPoolId: this.userPoolId,
        err: serializeError(err),
        message: 'Unexpected error checking user existence in Cognito',
      });
      return false;
    }
  }

  /**
   * Create a new user in Cognito User Pool
   * @param email - User email address
   * @throws Error if user creation fails
   */
  async createUser(email: string): Promise<void> {
    if (!this.userPoolId) {
      const error = new Error('Cognito User Pool ID is not configured');
      logger.error({
        event: 'cognito_create_user_failed',
        email,
        err: serializeError(error),
        message: 'Cannot create user in Cognito: User Pool ID not configured',
      });
      throw error;
    }

    try {
      const cmd = new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS', // Suppress welcome email
      });
      await this.client.send(cmd);
      logger.info({
        event: 'cognito_user_created',
        email,
        userPoolId: this.userPoolId,
        message: 'User created successfully in Cognito',
      });
    } catch (err) {
      if (err instanceof UsernameExistsException) {
        logger.info({
          event: 'cognito_user_already_exists',
          email,
          userPoolId: this.userPoolId,
          message: 'User already exists in Cognito, skipping creation',
        });
        // User already exists, this is not an error - just return
        return;
      }
      logger.error({
        event: 'cognito_create_user_error',
        email,
        userPoolId: this.userPoolId,
        err: serializeError(err),
        message: 'Failed to create user in Cognito',
      });
      throw err;
    }
  }
}
