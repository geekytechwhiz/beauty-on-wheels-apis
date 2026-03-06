import { PutCommand, QueryCommand, type PutCommandOutput, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { sendDoc } from '../../utils/dynamodb-send';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { KeyBuilder } from '@api-hub/utils';
import type { UserMetadata } from '../../models';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

const USER_TABLE = process.env.USER_TABLE || '';

export class UserMetadataRepository {
  async updateUserMetadata(
    userId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId });
    const now = new Date().toISOString();

    const item = {
      pk: KeyBuilder.userPk(userId),
      sk: KeyBuilder.userMetadataSk(),
      userId,
      metadata,
      updatedAt: now,
      itemType: 'USER_METADATA',
    };

    try {
      await sendDoc<PutCommandOutput>(ddbDocClient,
        new PutCommand({
          TableName: USER_TABLE,
          Item: item,
        }),
      );

      logger.info({
        event: 'user_metadata_updated',
        message: 'User metadata updated',
      });
    } catch (err) {
      logger.error({
        event: 'user_metadata_update_error',
        err: serializeError(err),
        message: 'Failed to update user metadata',
      });
      throw err;
    }
  }

  async getUserMetadata(userId: string): Promise<UserMetadata | null> {
    const logger = createChildLogger(baseLogger, { userId });

    try {
      const result = await sendDoc<QueryCommandOutput>(ddbDocClient,
        new QueryCommand({
          TableName: USER_TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': KeyBuilder.userPk(userId),
            ':sk': KeyBuilder.orgPrefix(),
          },
          Limit: 1,
        }),
      );

      const item = result.Items?.[0];

      if (!item) {
        logger.info({
          event: 'user_metadata_not_found',
          message: 'User metadata not found',
        });
        return null;
      }

      return {
        userId: item.userId as string,
        metadata: (item.metadata as Record<string, unknown>) || {},
        updatedAt: item.updatedAt as string,
      };
    } catch (err) {
      logger.error({
        event: 'user_metadata_get_error',
        err: serializeError(err),
        message: 'Failed to get user metadata',
      });
      throw err;
    }
  }
}

