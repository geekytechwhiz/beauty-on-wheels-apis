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

    const hasEmail =
      typeof input.email === 'string' && input.email.trim() !== '';
    const hasPhone =
      typeof input.phone === 'string' && input.phone.trim() !== '';

    const [userServiceUser, cognitoUser] = await Promise.all([
      this.userServiceClient.findUserByExternalId(
        { externalId: input.externalId },
        context,
      ),
      hasEmail || hasPhone
        ? this.cognitoService.findCognitoUserByEmailOrPhone({
            email: input.email,
            phone: input.phone,
          })
        : Promise.resolve(null),
    ]);

    if (userServiceUser && cognitoUser) {
      logger.info({
        event: 'user_existence_found_in_user_service_and_cognito',
        userId: userServiceUser.id,
        cognitoUserId: cognitoUser.userId,
        organizationId:
          userServiceUser.organizationId ?? cognitoUser.organizationId,
      });
    } else if (userServiceUser) {
      logger.info({
        event: 'user_existence_found_in_user_service',
        userId: userServiceUser.id,
      });
    } else if (cognitoUser) {
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
      userServiceUser,
      cognitoUser,
    };
  }
}
