import {
  createChildLogger,
  createLogger,
  serializeError,
} from '@api-hub/logger';
import { UserValidationRepository } from '../repositories/userValidation.repository';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

export interface ValidateUserExistsRequest {
  provider: string;
  externalId: string;
  tenantId: string;
}

export interface ValidateUserExistsResult {
  exists: boolean;
  cognitoUser?: {
    identifier: string;
    userID?: string;
    organizationID?: string;
    provider?: string;
    externalId?: string;
    tenantId?: string;
  };
}

export class UserValidationService {
  private readonly repository: UserValidationRepository;

  constructor(repository?: UserValidationRepository) {
    this.repository = repository || new UserValidationRepository();
  }

  /**
   * Validate whether a user already exists in Cognito based on externalId.
   * Currently provider and tenantId are used for logging/traceability only.
   */
  async validateUserExists(
    payload: ValidateUserExistsRequest,
    correlationId?: string,
  ): Promise<ValidateUserExistsResult> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      provider: payload.provider,
      tenantId: payload.tenantId,
    });

    logger.info({
      event: 'validate_user_exists_start',
      externalId: payload.externalId,
    });

    try {
      const exists = await this.repository.existsByExternalId(
        payload.externalId,
        correlationId,
      );

      let cognitoUser: ValidateUserExistsResult['cognitoUser'] | undefined;

      if (exists) {
        const attrs = await this.repository.getUserFromCognito(
          payload.externalId,
          correlationId,
        );

        if (attrs) {
          cognitoUser = {
            identifier: payload.externalId,
            userID: attrs.userID,
            organizationID: attrs.organizationID,
          };
        }
      }

      logger.info({
        event: 'validate_user_exists_complete',
        exists,
      });

      return { exists, cognitoUser };
    } catch (err) {
      logger.error({
        event: 'validate_user_exists_error',
        err: serializeError(err as Error),
        message: 'Unexpected error while validating user existence',
      });
      throw err;
    }
  }
}

