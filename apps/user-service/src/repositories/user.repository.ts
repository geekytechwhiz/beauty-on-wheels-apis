import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { User, UserMetadata, UserOrganization, UserFile } from '../models';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const USER_TABLE_NAME = process.env.USER_TABLE || '';

// DynamoDB table for users is currently keyed with lowercase `pk` / `sk`
// We keep uppercase PK/SK only as duplicate attributes on writes (non-key attributes)
// so all key operations MUST use lowercase `pk` / `sk`.
type UserDBItem = User & {
  pk: string;
  sk: string;
  PK?: string;
  SK?: string;
};

function modifyIndexesUsers(user: User): UserDBItem {
  return {
    ...user,
    pk: `ORG#${user.organizationID}`,
    sk: `USER#${user.userID}`,
  };
}

function modifyIndexesUserOrg(user: User): UserDBItem {
  return {
    ...user,
    pk: `USER#${user.userID}`,
    sk: `ORG#${user.organizationID}`,
  };
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

const userOrgPk = (organizationId: string): string => {
  return `ORG#${organizationId}`;
}

export interface ListOrganizationUsersOptions {
  limit?: number;
  offset?: number;
  /**
   * Filter by user status (case-insensitive).
   */
  status?: string;
  /**
   * Filter by userType (e.g. "USER", "STAFF", "FNF"), case-insensitive.
   */
  userType?: string;
  /**
   * Free-text search across common user fields.
   */
  search?: string;
  /**
   * Field used for in-memory sorting. Defaults to "createdDate".
   */
  sortBy?: 'createdDate' | 'fullName' | 'firstName' | 'lastName' | 'emailAddress';
  /**
   * Sort direction. Defaults to "desc".
   */
  sortOrder?: 'asc' | 'desc';
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

  async getUser(userId: string, organizationId?: string): Promise<User | null> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    logger.info({ event: 'user_get_start', message: 'Getting user' });
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: USER_TABLE_NAME,
          Key: organizationId
            ? {
                // New schema layout in this service: pk=ORG#orgId, sk=USER#userId
                pk: userOrgPk(organizationId),
                sk: userPk(userId),
              }
            : {
                // Legacy layout: pk=USER#userId, sk=USER_DETAILS
                pk: userPk(userId),
                sk: userDetailsSk(),
              },
        }),
      );
      logger.info({ event: 'user_get_success', message: 'User retrieved successfully', result: result.Item });
      if (!result.Item || result.Item.deleted === true) {
        logger.info({ event: 'user_get_not_found', message: 'User not found' });
        return null;
      }

      logger.info({ event: 'user_get_success', message: 'User retrieved successfully' });
      return result.Item as User;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({ event: 'user_get_error', message: 'Failed to get user' });
      throw err;
    }
  }

  async updateUser(userId: string, organizationId: string, updates: Partial<User>): Promise<void> {
    const updateParts: string[] = ['modifiedDate = :modifiedDate'];
    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': updates.modifiedDate ?? Date.now(),
    };

    // Dynamically build update expression for all provided fields
    // Exclude internal fields that shouldn't be updated directly
    const excludeFields = ['pk', 'sk', 'userID', 'organizationID', 'createdDate', 'modifiedDate'];
    
    for (const [key, value] of Object.entries(updates)) {
      if (excludeFields.includes(key) || value === undefined) {
        continue;
      }

      // Handle reserved words and special characters in DynamoDB attribute names
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      
      updateParts.push(`${attrName} = ${attrValue}`);
      exprNames[attrName] = key;
      exprValues[attrValue] = value;
    }

    if (updateParts.length === 1) {
      // Only modifiedDate was set, nothing to update
      const logger = createChildLogger(baseLogger, { userId });
      logger.warn({ event: 'user_update_no_changes', message: 'No fields to update' });
      return;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userOrgPk(organizationId),
            sk: userPk(userId),
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({ event: 'user_updated', message: 'User updated', fields: Object.keys(updates) });
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
    // const logger = createChildLogger(baseLogger, {
    //   userId,
    //   pk: userPk(userId),
    //   skPrefix: 'USER#',
    // });
    console.info({
      event: 'user_orgs_list_start',
      message: 'Listing user organizations',
    });

    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': userPk(userId),
            ':skPrefix': 'USER#',
          },
        }),
      );

      const items = (result?.Items ?? []) as UserOrganization[];
      logger.info({
        event: 'user_orgs_list_success',
        message: 'Successfully listed user organizations',
        count: items.length,
        rawCount: result?.Count,
        scannedCount: result?.ScannedCount,
      });

      return items;
    } catch (err) {
      logger.error({
        event: 'user_orgs_list_error',
        err: serializeError(err),
        message: 'Failed to list user organizations',
      });
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

  async listOrganizationUsers(
    organizationId: string,
    options: ListOrganizationUsersOptions = {},
  ): Promise<User[]> {
    const {
      limit,
      offset = 0,
      status,
      userType,
      search,
      sortBy = 'createdDate',
      sortOrder = 'desc',
    } = options;

    try {
      console.info('listOrganizationUsers', organizationId, {
        limit,
        offset,
        status,
        userType,
        search,
        sortBy,
        sortOrder,
      });

      // First try with lowercase key names (pk/sk)
      try {
        const queryLimit =
          typeof limit === 'number' && limit > 0 ? limit + Math.max(offset, 0) : undefined;

        const result = await docClient.send(
          new QueryCommand({
            TableName: USER_TABLE_NAME,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
            ExpressionAttributeValues: {
              ':pk': `ORG#${organizationId}`,
              ':skPrefix': 'USER#',
            },
            ...(queryLimit ? { Limit: queryLimit } : {}),
          }),
        );

        let users = (result.Items ?? []) as User[];

        // In-memory filtering
        if (status) {
          const statusLc = status.toLowerCase();
          users = users.filter(
            (u) => String((u as any).status ?? '').toLowerCase() === statusLc,
          );
        }

        if (userType) {
          const userTypeLc = userType.toLowerCase();
          users = users.filter(
            (u) => String((u as any).userType ?? '').toLowerCase() === userTypeLc,
          );
        }

        if (search) {
          const term = search.toLowerCase();
          users = users.filter((u) => {
            const fullName = String((u as any).fullName ?? '').toLowerCase();
            const firstName = String((u as any).firstName ?? '').toLowerCase();
            const lastName = String((u as any).lastName ?? '').toLowerCase();
            const emailAddress = String((u as any).emailAddress ?? '').toLowerCase();
            return (
              fullName.includes(term) ||
              firstName.includes(term) ||
              lastName.includes(term) ||
              emailAddress.includes(term)
            );
          });
        }

        // In-memory sorting
        users.sort((a: any, b: any) => {
          const dir = sortOrder === 'asc' ? 1 : -1;
          const aVal = a[sortBy];
          const bVal = b[sortBy];

          if (aVal == null && bVal == null) return 0;
          if (aVal == null) return 1 * dir;
          if (bVal == null) return -1 * dir;

          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return (aVal - bVal) * dir;
          }

          const aStr = String(aVal).toLowerCase();
          const bStr = String(bVal).toLowerCase();
          if (aStr < bStr) return -1 * dir;
          if (aStr > bStr) return 1 * dir;
          return 0;
        });

        // In-memory pagination
        const safeOffset = Math.max(offset, 0);
        if (limit && limit > 0) {
          return users.slice(safeOffset, safeOffset + limit);
        }
        if (safeOffset > 0) {
          return users.slice(safeOffset);
        }
        return users;
      } catch (innerErr) {
        const name = (innerErr as { name?: string }).name;
        const message = (innerErr as { message?: string }).message || '';

        // If DynamoDB complains that PK is missing, the actual key schema is PK/SK – retry with uppercase keys
        if (name === 'ValidationException' && message.includes('PK')) {
          console.info('listOrganizationUsers_retry_with_PK_SK', {
            organizationId,
            pk: userOrgPk(organizationId),
          });

          const queryLimit =
            typeof limit === 'number' && limit > 0
              ? limit + Math.max(offset, 0)
              : undefined;

          const fallbackResult = await docClient.send(
            new QueryCommand({
              TableName: USER_TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
              ExpressionAttributeValues: {
                ':pk': userOrgPk(organizationId),
                ':skPrefix': 'USER#',
              },
              ...(queryLimit ? { Limit: queryLimit } : {}),
            }),
          );

          let users = (fallbackResult.Items ?? []) as User[];

          if (status) {
            const statusLc = status.toLowerCase();
            users = users.filter(
              (u) => String((u as any).status ?? '').toLowerCase() === statusLc,
            );
          }

          if (userType) {
            const userTypeLc = userType.toLowerCase();
            users = users.filter(
              (u) => String((u as any).userType ?? '').toLowerCase() === userTypeLc,
            );
          }

          if (search) {
            const term = search.toLowerCase();
            users = users.filter((u) => {
              const fullName = String((u as any).fullName ?? '').toLowerCase();
              const firstName = String((u as any).firstName ?? '').toLowerCase();
              const lastName = String((u as any).lastName ?? '').toLowerCase();
              const emailAddress = String((u as any).emailAddress ?? '').toLowerCase();
              return (
                fullName.includes(term) ||
                firstName.includes(term) ||
                lastName.includes(term) ||
                emailAddress.includes(term)
              );
            });
          }

          users.sort((a: any, b: any) => {
            const dir = sortOrder === 'asc' ? 1 : -1;
            const aVal = a[sortBy];
            const bVal = b[sortBy];

            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1 * dir;
            if (bVal == null) return -1 * dir;

            if (typeof aVal === 'number' && typeof bVal === 'number') {
              return (aVal - bVal) * dir;
            }

            const aStr = String(aVal).toLowerCase();
            const bStr = String(bVal).toLowerCase();
            if (aStr < bStr) return -1 * dir;
            if (aStr > bStr) return 1 * dir;
            return 0;
          });

          const safeOffset = Math.max(offset, 0);
          if (limit && limit > 0) {
            return users.slice(safeOffset, safeOffset + limit);
          }
          if (safeOffset > 0) {
            return users.slice(safeOffset);
          }
          return users;
        }

        // Any other error, bubble up to outer catch
        throw innerErr;
      }
    } catch (err) {
      const logger = createChildLogger(baseLogger, { organizationId });
      logger.error({
        event: 'org_users_list_error',
        err: serializeError(err),
        message: 'Failed to list organization users',
      });
      throw err;
    }
  }
}

