import { PutCommand, QueryCommand, DeleteCommand, type PutCommandOutput, type QueryCommandOutput, type DeleteCommandOutput } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../utils/db.config';
import { sendDoc } from '../../utils/dynamodb-send';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/observability';
import { KeyBuilder } from '@api-hub/utils';
import { UserFile } from '../../models/user-file.model';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

const USER_TABLE = process.env.USER_TABLE || '';

export class UserFileRepository {
  /**
   * Create a new user file record.
   */
  async create(userFile: UserFile): Promise<void> {
    const logger = createChildLogger(baseLogger, {
      userId: userFile.userId,
      fileId: userFile.fileId,
    });

    const item = {
      pk: KeyBuilder.userPk(userFile.userId),
      sk: KeyBuilder.userFileSk(userFile.fileId),
      userId: userFile.userId,
      fileId: userFile.fileId,
      fileName: userFile.fileName,
      s3Key: userFile.s3Key,
      uploadedAt: userFile.uploadedAt,
      itemType: 'USER_FILE',
    };

    try {
      await sendDoc<PutCommandOutput>(docClient,
        new PutCommand({
          TableName: USER_TABLE,
          Item: item,
        }),
      );

      logger.info({
        event: 'user_file_created',
        message: 'User file created',
      });
    } catch (err) {
      logger.error({
        event: 'user_file_create_error',
        err: serializeError(err),
        message: 'Failed to create user file',
      });
      throw err;
    }
  }

  /**
   * List files for a user.
   */
  async listByUser(userId: string): Promise<UserFile[]> {
    const logger = createChildLogger(baseLogger, { userId });

    try {
      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
          TableName: USER_TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': KeyBuilder.userPk(userId),
            ':skPrefix': KeyBuilder.beginsWith('USER_FILE#'),
          },
        }),
      );

      const items = (result.Items || []) as UserFile[];

      logger.info({
        event: 'user_files_list_success',
        message: 'Successfully listed user files',
        count: items.length,
      });

      return items;
    } catch (err) {
      logger.error({
        event: 'user_files_list_error',
        err: serializeError(err),
        message: 'Failed to list user files',
      });
      throw err;
    }
  }

  /**
   * Delete a user file record.
   */
  async delete(userId: string, fileId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId, fileId });

    try {
      await sendDoc<DeleteCommandOutput>(docClient,
        new DeleteCommand({
          TableName: USER_TABLE,
          Key: {
            pk: KeyBuilder.userPk(userId),
            sk: KeyBuilder.userFileSk(fileId),
          },
        }),
      );

      logger.info({
        event: 'user_file_deleted',
        message: 'User file deleted',
      });
    } catch (err) {
      logger.error({
        event: 'user_file_delete_error',
        err: serializeError(err),
        message: 'Failed to delete user file',
      });
      throw err;
    }
  }
}

