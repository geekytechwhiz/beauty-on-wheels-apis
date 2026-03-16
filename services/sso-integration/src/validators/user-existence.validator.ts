import { createChildLogger, type Logger } from '@api-hub/logger';

import { SSOUserServiceClient } from '../clients/user-service.client';
import { CognitoService } from '../services/cognito.service';
import { SSORequestContext } from '../types/common/context.types';
import { CognitoUserContext, User } from '../types/user/user.types';

export interface UserExistenceCheckInput {
  externalId: string;
  email?: string | null;
  phone?: string | null;
}

export interface UserExistenceCheckResult {
  userServiceUser: User | null;
  cognitoUser: CognitoUserContext | null;
}

export class UserExistenceValidator {
  constructor(
    private readonly userServiceClient: SSOUserServiceClient,
    private readonly cognitoService: CognitoService,
    private readonly logger: Logger,
  ) {}

  async checkUserExists(
    input: UserExistenceCheckInput,
    context: SSORequestContext,
  ): Promise<UserExistenceCheckResult> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      externalId: input.externalId,
      email: input.email ?? undefined,
      phone: input.phone ?? undefined,
    });

    const userServiceUser = await this.userServiceClient.findUserByExternalId(
      { externalId: input.externalId },
      context,
    );

    if (userServiceUser) {
      logger.info({
        event: 'user_existence_found_in_user_service',
        userId: userServiceUser.id,
      });

      return {
        userServiceUser,
        cognitoUser: null,
      };
    }

    const cognitoUser = await this.cognitoService.findCognitoUserByEmailOrPhone({
      email: input.email,
      phone: input.phone,
    });

    if (cognitoUser) {
      logger.info({
        event: 'user_existence_found_in_cognito',
        userId: cognitoUser.userId,
        organizationId: cognitoUser.organizationId,
      });
    } else {
      logger.info({
        event: 'user_existence_not_found',
      });
    }

    return {
      userServiceUser: null,
      cognitoUser,
    };
  }
}
