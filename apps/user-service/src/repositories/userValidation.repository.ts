import { CognitoService } from '../services/cognito.service';
import {
  createChildLogger,
  createLogger,
  serializeError,
} from '@api-hub/logger';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

export class UserValidationRepository {
  private readonly cognitoService: CognitoService;

  constructor(region?: string, userPoolId?: string) {
    const resolvedRegion =
      region || process.env.DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
    const resolvedUserPoolId =
      userPoolId || process.env.COGNITO_USER_POOL_ID || '';

    this.cognitoService = new CognitoService(resolvedRegion, resolvedUserPoolId);
  }

  /**
   * Check if a user exists in Cognito using an external identifier.
   * The identifier can be a username, email, or phone number.
   */
  async existsByExternalId(
    externalId: string,
    correlationId?: string,
  ): Promise<boolean> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      externalId,
    });

    logger.info({
      event: 'user_validation_exists_start',
      externalId,
    });

    try {
      const trimmed = String(externalId || '').trim();
      if (!trimmed) {
        logger.warn({
          event: 'user_validation_exists_empty_identifier',
          message: 'External identifier is empty, skipping Cognito check',
        });
        return false;
      }

      const exists = await this.cognitoService.userExistsIdentifier(trimmed);

      logger.info({
        event: 'user_validation_exists_result',
        exists,
      });

      return exists;
    } catch (err) {
      logger.error({
        event: 'user_validation_exists_error',
        err: serializeError(err as Error),
        message: 'Failed to validate user existence in Cognito',
      });
      throw err;
    }
  }

  /**
   * Fetch basic user data from Cognito for the given identifier.
   * Currently returns custom:userID and custom:organizationID attributes.
   */
  async getUserFromCognito(
    externalId: string,
    correlationId?: string,
  ): Promise<{ userID?: string; organizationID?: string } | null> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      externalId,
    });

    logger.info({
      event: 'user_validation_get_user_start',
      externalId,
    });

    try {
      const trimmed = String(externalId || '').trim();
      if (!trimmed) {
        logger.warn({
          event: 'user_validation_get_user_empty_identifier',
          message: 'External identifier is empty, skipping Cognito getUserAttributes',
        });
        return null;
      }

      const attrs = await this.cognitoService.getUserAttributes(trimmed);

      if (!attrs.userID && !attrs.organizationID) {
        logger.info({
          event: 'user_validation_get_user_not_found',
          externalId,
        });
        return null;
      }

      logger.info({
        event: 'user_validation_get_user_success',
        userID: attrs.userID,
        organizationID: attrs.organizationID,
      });

      return attrs;
    } catch (err) {
      logger.error({
        event: 'user_validation_get_user_error',
        err: serializeError(err as Error),
        message: 'Failed to get user from Cognito',
      });
      throw err;
    }
  }
}

