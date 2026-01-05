import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { User, UserMetadata, UserOrganization, UserFile } from '../models';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const USER_TABLE_NAME = process.env.USER_TABLE || '';

type UserDBItem = User & {
  pk: string;
  sk: string;
}

function modifyIndexesUsers(user: User): UserDBItem {
  return {
    ...user,
    pk: `ORG#${user.organizationID}`,
    sk: `USER#${user.userID}`,
  }
}

function modifyIndexesUserOrg(user: User): UserDBItem {
  return {
    ...user,
    pk: `USER#${user.userID}`,
    sk: `ORG#${user.organizationID}`,
  }
}

function userPk(userId: string): string {
  return `USER#${userId}`;
}

function userDetailsSk(): string {
  return 'USER_DETAILS';
}

// function userOrgSk(organizationId: string): string {
//   return `USER_ORG#${organizationId}`;
// }

function userMetadataSk(): string {
  return 'USER_METADATA';
}

function userFileSk(fileId: string): string {
  return `USER_FILE#${fileId}`;
}

export class UserRepository {
  async createUser(user: User): Promise<void> {
    const item = modifyIndexesUsers(user);
    try {
      await docClient.send(
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { userId: user.userID });
      logger.info({ event: 'user_created', message: 'User created' });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { userId: user.userID });
      if (code === 'ConditionalCheckFailedException') {
        throw new UserAlreadyExistsError(user.userID);
      }
      logger.error({ event: 'user_create_error', err: serializeError(err), message: 'Failed to create user' });
      throw err;
    }
  }

  async getUser(userId: string): Promise<User | null> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userPk(userId),
            sk: userDetailsSk(),
          },
        }),
      );

      if (!result.Item || result.Item.deleted === true) {
        return null;
      }

      return result.Item as User;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({ event: 'user_get_error', err: serializeError(err), message: 'Failed to get user' });
      throw err;
    }
  }

  async updateUser(userId: string, updates: { email?: string; name?: string }): Promise<void> {
    const now = new Date().toISOString();
    const updateParts: string[] = ['updatedAt = :updatedAt'];
    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {
      ':updatedAt': now,
    };

    if (updates.email !== undefined) {
      updateParts.push('#email = :email');
      exprNames['#email'] = 'email';
      exprValues[':email'] = updates.email;
    }

    if (updates.name !== undefined) {
      updateParts.push('#name = :name');
      exprNames['#name'] = 'name';
      exprValues[':name'] = updates.name;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userPk(userId),
            sk: userDetailsSk(),
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({ event: 'user_updated', message: 'User updated' });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { userId });
      if (code === 'ConditionalCheckFailedException') {
        throw new UserNotFoundError(userId);
      }
      logger.error({ event: 'user_update_error', err: serializeError(err), message: 'Failed to update user' });
      throw err;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userPk(userId),
            sk: userDetailsSk(),
          },
          UpdateExpression: 'SET deleted = :deleted, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':deleted': true,
            ':updatedAt': now,
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({ event: 'user_deleted', message: 'User deleted' });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { userId });
      if (code === 'ConditionalCheckFailedException') {
        throw new UserNotFoundError(userId);
      }
      logger.error({ event: 'user_delete_error', err: serializeError(err), message: 'Failed to delete user' });
      throw err;
    }
  }

  async assignUserToOrganization(user: User): Promise<void> {
    const item = modifyIndexesUserOrg(user);

    try {
      await docClient.send(
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
        }),
      );
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId: user.userID, organizationId: user.organizationID });
      logger.error({
        event: 'user_org_assign_error',
        err: serializeError(err),
        message: 'Failed to assign user to organization',
      });
      throw err;
    }
  }

  async listUserOrganizations(userId: string): Promise<UserOrganization[]> {
    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': userPk(userId),
            ':skPrefix': 'USER_ORG#',
          },
        }),
      );

      return (result?.Items ?? []) as UserOrganization[];
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({ event: 'user_orgs_list_error', err: serializeError(err), message: 'Failed to list user organizations' });
      throw err;
    }
  }

  async updateUserMetadata(userId: string, metadata: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    const item = {
      pk: userPk(userId),
      sk: userMetadataSk(),
      userId,
      metadata,
      updatedAt: now,
      itemType: 'USER_METADATA',
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({ event: 'user_metadata_updated', message: 'User metadata updated' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({ event: 'user_metadata_update_error', err: serializeError(err), message: 'Failed to update user metadata' });
      throw err;
    }
  }

  async getUserMetadata(userId: string): Promise<UserMetadata | null> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userPk(userId),
            sk: userMetadataSk(),
          },
        }),
      );

      if (!result.Item) {
        return null;
      }

      return {
        userId: result.Item.userId as string,
        metadata: (result.Item.metadata as Record<string, unknown>) || {},
        updatedAt: result.Item.updatedAt as string,
      };
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({ event: 'user_metadata_get_error', err: serializeError(err), message: 'Failed to get user metadata' });
      throw err;
    }
  }

  async createUserFile(userFile: UserFile): Promise<void> {
    const item = {
      pk: userPk(userFile.userId),
      sk: userFileSk(userFile.fileId),
      userId: userFile.userId,
      fileId: userFile.fileId,
      fileName: userFile.fileName,
      s3Key: userFile.s3Key,
      uploadedAt: userFile.uploadedAt,
      itemType: 'USER_FILE',
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, { userId: userFile.userId, fileId: userFile.fileId });
      logger.info({ event: 'user_file_created', message: 'User file created' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId: userFile.userId, fileId: userFile.fileId });
      logger.error({
        event: 'user_file_create_error',
        err: serializeError(err),
        message: 'Failed to create user file',
      });
      throw err;
    }
  }

  async listUserFiles(userId: string): Promise<UserFile[]> {
    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': userPk(userId),
            ':skPrefix': 'USER_FILE#',
          },
        }),
      );

      return (result.Items ?? []) as UserFile[];
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({ event: 'user_files_list_error', err: serializeError(err), message: 'Failed to list user files' });
      throw err;
    }
  }
}

