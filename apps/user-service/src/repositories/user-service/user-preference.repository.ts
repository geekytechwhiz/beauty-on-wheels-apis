import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { KeyBuilder } from '@api-hub/utils';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

const USER_TABLE = process.env.USER_TABLE || '';

export class UserPreferenceRepository {
  /**
   * Gets user preferences (for schedule configuration).
   */
  async getUserPreferences(
    userId: string,
    organizationId: string,
  ): Promise<Record<string, unknown>> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });

    try {
      console.log('getUserPreferences', userId, organizationId);
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: USER_TABLE,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
          ExpressionAttributeNames: {
            '#pk': 'pk',
            '#sk': 'sk',
          },
          ExpressionAttributeValues: {
            ':pk': KeyBuilder.userPk(userId),
            ':sk': KeyBuilder.userPreferenceSk(),
          },
        }),
      );

      if (!result.Items || result.Items.length === 0) {
        return {};
      }

      const item = result.Items[0];
      const {
        pk,
        sk,
        userID,
        createdDate,
        modifiedDate,
        organizationID,
        ...rest
      } = item as Record<string, unknown>;

      logger.info({ event: 'getUserPreferences_success', userId });
      return rest;
    } catch (err) {
      logger.error({
        event: 'getUserPreferences_error',
        err: serializeError(err),
      });
      return {};
    }
  }

  /**
   * Gets user basic details (for FNF details).
   */
  async getUserBasicDetails(
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const logger = createChildLogger(baseLogger, { userId });

    try {
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: USER_TABLE,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
          ExpressionAttributeNames: {
            '#pk': 'pk',
            '#sk': 'sk',
          },
          ExpressionAttributeValues: {
            ':pk': KeyBuilder.userPk(userId),
            ':sk': KeyBuilder.orgPrefix(),
          },
        }),
      );

      if (result.Items && result.Items.length > 0) {
        logger.info({ event: 'getUserBasicDetails_success', userId });
        return result.Items[0] as Record<string, unknown>;
      }

      return null;
    } catch (err) {
      logger.error({
        event: 'getUserBasicDetails_error',
        err: serializeError(err),
      });
      return null;
    }
  }
}

