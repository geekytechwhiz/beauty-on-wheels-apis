import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
  type GetCommandOutput,
  type PutCommandOutput,
  type UpdateCommandOutput,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { sendDoc } from '../utils/dynamodb-send';
import {
  createLogger,
  serializeError,
  createChildLogger,
} from '@api-hub/observability';
import {
  User,
  Appointment,
  UserMetadata,
  UserOrganization,
  UserFile,
  UserResponse,
} from '../models';
import { UserNotFoundError, UserAlreadyExistsError, InviteUpdateTooSoonError } from '../utils/errors';
import { getRoleDetails } from '../services/role.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const USER_TABLE_NAME = process.env.USER_TABLE || '';
const ROLES_TABLE_NAME = process.env.ROLES_TABLE || '';

/**
 * Maps a User object (or DynamoDB item) to UserResponse interface
 * Returns only the fields specified in UserResponse
 */
function mapToUserResponse(user: any): UserResponse {
  return {
    phoneNumber: user.phoneNumber || '',
    createdDate: user.createdDate || user.createdAt || 0,
    userType: user.userType || '',
    lastName: user.lastName || '',
    isRpmUser: user.isRpmUser || false,
    profilePic: user.profilePic || '',
    mrn: user.mrn || '',
    modifiedDate: user.modifiedDate || 0,
    fullName: user.fullName || '',
    firstName: user.firstName || '',
    roleID: user.roleID || user.roleId || '',
    city: user.city || '',
    roleType: user.roleType || user.userType || '',
    isActive: user.isActive !== undefined ? user.isActive : true,
    accountType: user.accountType || 'REGULAR',
    emailAddress: user.emailAddress || '',
    userID: user.userID || user.userId || '',
    organizationID: user.organizationID || user.organizationId || '',
    phoneCode: user.phoneCode || '',
    sk: user.sk || '',
    pk: user.pk || '',
    postalCode: user.postalCode || user.zip || '',
    sk1: user.sk1 || user.userType || 'USER',
    status:
      user.status !== undefined
        ? user.status
        : user.isActive !== undefined
          ? user.isActive
          : true,
    createdAt: user.createdAt || user.createdDate || 0,
    roleName: user.roleName,
    definedRoleCode: user.definedRoleCode || user.userType || '',
    specialty: user.specialty || '',
    // specialty is not a property of UserResponse, so we remove it to fix the lint error
  };
}
type UserDBItem = User & {
  pk: string;
  sk: string;
  PK?: string;
  SK?: string;
  gsi1Pk?: string;
  gsi1Sk?: string;
};

function buildExternalIdentityQueryKeys(
  tenant: string,
  provider: string,
  externalUserId: string,
): { gsi1Pk: string; gsi1Sk: string } {
  const normalizedTenant = tenant.trim().toLowerCase();
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedExternalUserId = externalUserId.trim().toLowerCase();

  return {
    gsi1Pk: `TENANT#${normalizedTenant}#PROVIDER#${normalizedProvider}`,
    gsi1Sk: `EXTERNAL_USER#${normalizedExternalUserId}`,
  };
}
function buildExternalIdentityKeys(
  user: User,
): Pick<UserDBItem, 'gsi1Pk' | 'gsi1Sk'> | {} {
  const ext = user.externalIdentity;

  if (!ext) {
    return {};
  }

  const provider = ext.provider?.trim();
  const externalUserId = ext.externalUserId?.trim();

  if (!provider || !externalUserId) {
    return {};
  }

  const tenant =
    ext.tenant?.trim() ||
    ext.subdomain?.trim();

  if (!tenant) {
    return {};
  }

  const { gsi1Pk, gsi1Sk } = buildExternalIdentityQueryKeys(
    tenant,
    provider,
    externalUserId,
  );

  return { gsi1Pk, gsi1Sk };
}

function modifyIndexesUsers(user: User): UserDBItem {
  return {
    ...user,
    pk: `ORG#${user.organizationID}`,
    sk: `USER#${user.userID}`,
    ...buildExternalIdentityKeys(user),
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

function userFileSk(fileId: string): string {
  return `USER_FILE#${fileId}`;
}

function appointmentPk(patientUserId: string): string {
  return `USER#${patientUserId}`;
}

function appointmentSk(appointmentId: string): string {
  return `APPOINTMENT#${appointmentId}`;
}

const userOrgPk = (organizationId: string): string => {
  return `ORG#${organizationId}`;
};

const orgSK = (): string => {
  return `ORG#`;
};

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
  filter?: string;
  /**
   * Filter by specialty (case-insensitive).
   */
  specialty?: string;
  /**
   * Free-text search across common user fields.
   */
  search?: string;
  /**
   * Field used for in-memory sorting. Defaults to "createdDate".
   */
  sortBy?:
    | 'createdDate'
    | 'fullName'
    | 'firstName'
    | 'lastName'
    | 'emailAddress';
  /**
   * Sort direction. Defaults to "desc".
   */
  sortOrder?: 'asc' | 'desc';

  /**
   * Filter by previouslyConsulted field.
   */
  previouslyConsulted?: boolean;
}

export class UserRepository {
  async getUserByExternalIdentity(
    tenant: string,
    provider: string,
    externalUserId: string,
  ): Promise<User | null> {
    const logger = createChildLogger(baseLogger, {
      tenant,
      provider,
      externalUserId,
    });

    const { gsi1Pk, gsi1Sk } = buildExternalIdentityQueryKeys(
      tenant,
      provider,
      externalUserId,
    );

    logger.info({
      event: 'user_get_by_external_identity_start',
      gsi1Pk,
      gsi1Sk,
    });

    const result = await sendDoc<QueryCommandOutput>(
      docClient,
      new QueryCommand({
        TableName: USER_TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1Pk = :pk AND gsi1Sk = :sk',
        ExpressionAttributeValues: {
          ':pk': gsi1Pk,
          ':sk': gsi1Sk,
        },
        Limit: 1,
      }) as unknown as QueryCommandInput,
    );

    const item = result.Items?.[0] as UserDBItem | undefined;

    if (!item) {
      logger.info({
        event: 'user_get_by_external_identity_not_found',
        gsi1Pk,
        gsi1Sk,
      });
      return null;
    }

    logger.info({
      event: 'user_get_by_external_identity_success',
      gsi1Pk,
      gsi1Sk,
      userID: item.userID,
      organizationID: item.organizationID,
    });

    // strip internal index fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pk, sk, PK, SK, gsi1Pk: _gpk, gsi1Sk: _gsk, ...rest } = item;
    return rest as User;
  }

  async createUser(user: User): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId: user.userID });
  
    const mainUserItem = modifyIndexesUsers(user);
    logger.info({
      event: "external_identity_keys_generated",
      gsi1Pk: mainUserItem.gsi1Pk,
      gsi1Sk: mainUserItem.gsi1Sk,
    });
    try {
      await sendDoc(
        docClient,
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: USER_TABLE_NAME,
                Item: mainUserItem,
                ConditionExpression:
                  'attribute_not_exists(pk) AND attribute_not_exists(sk)',
              },
            },
          ],
        }),
      );
  
      logger.info({
        event: 'user_created',
        message: 'User created successfully',
      });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
  
      if (code === 'TransactionCanceledException') {
        throw new UserAlreadyExistsError(user.userID);
      }
  
      logger.error({
        event: 'user_create_error',
        err: serializeError(err),
        message: 'Failed to create user',
      });
  
      throw err;
    }
  }

  async checkUserExists(userId: string, organizationId: string): Promise<boolean> {
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({ event: 'user_check_exists_start', message: 'Checking if user exists' });
    try {
      const result = await sendDoc<GetCommandOutput>(docClient,
        new GetCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userOrgPk(organizationId),
            sk: userPk(userId),
          },
        }),
      );
      return !!result.Item;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({ event: 'user_check_exists_error', message: 'Failed to check if user exists' });
      throw err;
    }
  }

  async getUser(userId: string, organizationId?: string): Promise<User | null> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    logger.info({ event: 'user_get_start', message: 'Getting user' });
    try {
      let result;
      if (organizationId) {
        result = await sendDoc<GetCommandOutput>(docClient,
          new GetCommand({
            TableName: USER_TABLE_NAME,
            Key: {
              pk: userOrgPk(organizationId),
              sk: userPk(userId),
            },
          }),
        );
      } else {
        const queryResult = await sendDoc<QueryCommandOutput>(docClient,
          new QueryCommand({
            TableName: USER_TABLE_NAME,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
            ExpressionAttributeValues: {
              ':pk': userPk(userId),
              ':skPrefix': 'ORG#',
            },
            Limit: 1,
          }),
        );
        result = { Item: queryResult.Items?.[0] };
      }
      //console.log("RESULT: ", result);
      if (
        !result.Item ||
        result.Item.isDeleted === true ||
        result.Item.deleted === true
      ) {
        logger.info({ event: 'user_get_not_found', message: 'User not found' });
        return null;
      }

      logger.info({
        event: 'user_get_success',
        message: 'User retrieved successfully',
      });
      return result.Item as User;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({ event: 'user_get_error', message: 'Failed to get user' });
      throw err;
    }
  }

  /**
   * Get all user data items (user details, preferences, metadata, etc.)
   * This queries all items with pk = USER#userId
   */
  async getAllUserData(userId: string): Promise<any[]> {
    const logger = createChildLogger(baseLogger, { userId });
    logger.info({
      event: 'get_all_user_data_start',
      message: 'Getting all user data',
    });
    try {
      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': userPk(userId),
          },
        }),
      );
      logger.info({
        event: 'get_all_user_data_success',
        count: result.Items?.length || 0,
      });
      return result.Items || [];
    } catch (err) {
      logger.error({
        event: 'get_all_user_data_error',
        err: serializeError(err),
        message: 'Failed to get all user data',
      });
      throw err;
    }
  }

  async updateUser(
    userId: string,
    organizationId: string,
    updates: Partial<User>,
  ): Promise<void> {
    const updateParts: string[] = ['modifiedDate = :modifiedDate'];
    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': updates.modifiedDate ?? Date.now(),
    };

    // Dynamically build update expression for all provided fields
    // Exclude internal fields that shouldn't be updated directly
    const excludeFields = [
      'pk',
      'sk',
      'userID',
      'organizationID',
      'createdDate',
      'modifiedDate',
    ];

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
      logger.warn({
        event: 'user_update_no_changes',
        message: 'No fields to update',
      });
      return;
    }

    try {
      await sendDoc<UpdateCommandOutput>(docClient,
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
      logger.info({
        event: 'user_updated',
        message: 'User updated',
        fields: Object.keys(updates),
      });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { userId });
      if (code === 'ConditionalCheckFailedException') {
        throw new UserNotFoundError(userId);
      }
      logger.error({
        event: 'user_update_error',
        err: serializeError(err),
        message: 'Failed to update user',
      });
      throw err;
    }

    try {
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userPk(userId),
            sk: userOrgPk(organizationId),
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({
        event: 'user_updated_org_mapping',
        message: 'User org mapping updated',
        fields: Object.keys(updates),
      });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, { userId });
      if (code !== 'ConditionalCheckFailedException') {
        logger.warn({
          event: 'user_update_org_mapping_failed',
          err: serializeError(err),
        });
      }
    }
  }

  async deleteUser(userId: string, organizationId: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userPk(userId),
            sk: userOrgPk(organizationId),
          },
          UpdateExpression:
            'SET isDeleted = :isDeleted, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':isDeleted': true,
            ':updatedAt': now,
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userOrgPk(organizationId),
            sk: userPk(userId),
          },
          UpdateExpression:
            'SET isDeleted = :isDeleted, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':isDeleted': true,
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
      logger.error({
        event: 'user_delete_error',
        err: serializeError(err),
        message: 'Failed to delete user',
      });
      throw err;
    }
  }

  async assignUserToOrganization(user: User): Promise<void> {
    const item = modifyIndexesUserOrg(user);

    try {
      await sendDoc<PutCommandOutput>(docClient,
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
        }),
      );
    } catch (err) {
      const logger = createChildLogger(baseLogger, {
        userId: user.userID,
        organizationId: user.organizationID,
      });
      logger.error({
        event: 'user_org_assign_error',
        err: serializeError(err),
        message: 'Failed to assign user to organization',
      });
      throw err;
    }
  }

  async listUserOrganizations(userId: string): Promise<UserOrganization[]> {
    const logger = createChildLogger(baseLogger, {
      userId,
      pk: userPk(userId),
      skPrefix: 'ORG#',
    });
    console.info({
      event: 'user_orgs_list_start',
      message: 'Listing user organizations',
    });

    try {
      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': userPk(userId),
            ':skPrefix': 'ORG#',
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

  async getOrganizationUserCounts(
    organizationId: string,
    filters?: {
      roleId?: string;
      roleName?: string;
      roleType?: string;
      status?: string;
    },
  ): Promise<Array<Record<string, unknown>>> {
    const logger = createChildLogger(baseLogger, { organizationId });

    // Same key pattern as listOrganizationUsers: pk = ORG#orgId, sk begins_with USER#
    const pk = userOrgPk(organizationId);
    const allUsers: Array<Record<string, unknown>> = [];
    const keyCondition = 'pk = :pk AND begins_with(sk, :skPrefix)';
    const expressionValues: Record<string, unknown> = {
      ':pk': pk,
      ':skPrefix': 'USER#',
    };

    logger.info({ event: 'querying_users', pk, table: USER_TABLE_NAME });

    let lastKey: Record<string, unknown> | undefined;
    let useUppercaseKeys = false;

    // Fetch all users for the organization (pk=ORG#orgId, sk=USER#userId)
    do {
      const params: {
        TableName: string;
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
        ExclusiveStartKey?: Record<string, unknown>;
      } = {
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: useUppercaseKeys
          ? 'PK = :pk AND begins_with(SK, :skPrefix)'
          : keyCondition,
        ExpressionAttributeValues: expressionValues,
      };
      if (lastKey) params.ExclusiveStartKey = lastKey;

      let response: {
        Items?: unknown[];
        LastEvaluatedKey?: Record<string, unknown>;
      };
      try {
        response = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      } catch (innerErr: unknown) {
        const name = (innerErr as { name?: string }).name;
        const message = String(
          (innerErr as { message?: string }).message ?? '',
        );
        // Table may use PK/SK (uppercase) – retry with uppercase and re-paginate from start
        if (
          !useUppercaseKeys &&
          name === 'ValidationException' &&
          message.includes('PK')
        ) {
          useUppercaseKeys = true;
          lastKey = undefined;
          continue;
        }
        throw innerErr;
      }

      const rawItems = (response.Items || []) as Array<Record<string, unknown>>;
      allUsers.push(...rawItems);
      lastKey = response.LastEvaluatedKey;
    } while (lastKey);

    logger.info({ event: 'users_fetched', totalUsers: allUsers.length });

    // Group users by role and count them
    const roleCountMap = new Map<
      string,
      {
        roleId: string;
        roleName: string;
        definedRoleCode: string;
        roleType: string;
        status: string;
        count: number;
      }
    >();

    for (const user of allUsers) {
      // Extract role information from user record
      const roleId = String(user.roleID || (user as any)?.userRole[0] || '');
      const roleName = String(user?.roleName || '');
      const definedRoleCode = String(user?.definedRoleCode || roleName || '');
      const roleType = String(user.roleType || user.userType || '');

      // Determine status (ACTIVE/INACTIVE)
      let status = 'ACTIVE';
      if (
        user.status === false ||
        user.status === 'INACTIVE' ||
        user.isActive === false
      ) {
        status = 'INACTIVE';
      }

      // Skip if missing required fields
      if (!roleId) {
        logger.warn({ event: 'user_missing_role', userId: user.userID });
        continue;
      }

      // Create unique key for role + status combination
      const mapKey = `${roleId}#${status}`;

      if (roleCountMap.has(mapKey)) {
        // Increment count for existing role
        roleCountMap.get(mapKey)!.count++;
      } else {
        // Add new role entry
        roleCountMap.set(mapKey, {
          roleId,
          roleName,
          definedRoleCode,
          roleType,
          status,
          count: 1,
        });
      }
    }

    // Convert Map to array format matching ORG_USER_COUNT structure
    const countRecords: Array<Record<string, unknown>> = [];

    for (const [, roleData] of roleCountMap.entries()) {
      countRecords.push({
        pk: `ORG_USER_COUNT#${organizationId}`,
        sk: `${roleData.roleId}#${roleData.status}`,
        sk1: roleData.roleId,
        sk2: roleData.definedRoleCode,
        sk3: roleData.status,
        roleId: roleData.roleId,
        roleName: roleData.roleName,
        definedRoleCode: roleData.definedRoleCode,
        roleType: roleData.roleType,
        count: roleData.count,
      });
    }

    logger.info({
      event: 'user_counts_calculated',
      totalUsers: allUsers.length,
      uniqueRoles: countRecords.length,
      counts: countRecords.map((r) => ({ role: r.roleName, count: r.count })),
    });

    return countRecords;
  }

  async updateUserMetadata(
    userId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const item = {
      pk: userPk(userId),
      sk: orgSK(),
      userId,
      metadata,
      updatedAt: now,
      itemType: 'USER_METADATA',
    };

    try {
      await sendDoc<PutCommandOutput>(docClient,
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, { userId });
      logger.info({
        event: 'user_metadata_updated',
        message: 'User metadata updated',
      });
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({
        event: 'user_metadata_update_error',
        err: serializeError(err),
        message: 'Failed to update user metadata',
      });
      throw err;
    }
  }

  async getUserMetadata(userId: string): Promise<UserMetadata | null> {
    try {
      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': userPk(userId),
            ':sk': 'ORG#',
          },
          Limit: 1, // optional if you expect only one
        }),
      );

      const item = result.Items?.[0];

      if (!item) return null;

      return {
        userId: item.userId as string,
        metadata: (item.metadata as Record<string, unknown>) || {},
        updatedAt: item.updatedAt as string,
      };
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({
        event: 'user_metadata_get_error',
        err: serializeError(err),
        message: 'Failed to get user metadata',
      });
      throw err;
    }
  }

  async createAppointment(
    appointment: Omit<Appointment, 'createdAt' | 'updatedAt' | 'itemType'>,
    correlationId?: string,
  ): Promise<Appointment> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      appointmentId: appointment.appointmentId,
      patientUserId: appointment.patientUserId,
    });
    const now = Date.now();
    const item: Appointment & { pk: string; sk: string } = {
      pk: appointmentPk(appointment.patientUserId),
      sk: appointmentSk(appointment.appointmentId),
      ...appointment,
      createdAt: now,
      updatedAt: now,
      itemType: 'APPOINTMENT',
    };

    try {
      await sendDoc<PutCommandOutput>(docClient,
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
        }),
      );

      logger.info({
        event: 'appointment_create_success',
        message: 'Appointment created successfully',
      });

      const { pk, sk, ...appointmentItem } = item;
      return appointmentItem;
    } catch (err) {
      logger.error({
        event: 'appointment_create_error',
        err: serializeError(err),
        message: 'Failed to create appointment',
      });
      throw err;
    }
  }

  async getAppointment(
    patientUserId: string,
    appointmentId: string,
    correlationId?: string,
  ): Promise<Appointment | null> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      appointmentId,
      patientUserId,
    });

    try {
      const result = await sendDoc<GetCommandOutput>(docClient,
        new GetCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: appointmentPk(patientUserId),
            sk: appointmentSk(appointmentId),
          },
        }),
      );

      if (!result.Item) {
        logger.info({
          event: 'appointment_get_not_found',
          message: 'Appointment not found',
        });
        return null;
      }

      logger.info({
        event: 'appointment_get_success',
        message: 'Appointment retrieved successfully',
      });

      const { pk, sk, ...appointment } = result.Item as Appointment & {
        pk: string;
        sk: string;
      };

      return appointment;
    } catch (err) {
      logger.error({
        event: 'appointment_get_error',
        err: serializeError(err),
        message: 'Failed to get appointment',
      });
      throw err;
    }
  }

  async listAppointments(
    patientUserId: string,
    correlationId?: string,
  ): Promise<Appointment[]> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      patientUserId,
    });

    try {
      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': appointmentPk(patientUserId),
            ':skPrefix': appointmentSk(''),
          },
        }),
      );

      const items = (result.Items ?? []).map((item) => {
        const { pk, sk, ...appointment } = item as Appointment & {
          pk: string;
          sk: string;
        };
        return appointment;
      });

      logger.info({
        event: 'appointment_list_success',
        message: 'Appointments listed successfully',
        count: items.length,
      });

      return items;
    } catch (err) {
      logger.error({
        event: 'appointment_list_error',
        err: serializeError(err),
        message: 'Failed to list appointments',
      });
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
      await sendDoc<PutCommandOutput>(docClient,
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: item,
        }),
      );
      const logger = createChildLogger(baseLogger, {
        userId: userFile.userId,
        fileId: userFile.fileId,
      });
      logger.info({ event: 'user_file_created', message: 'User file created' });
    } catch (err) {
      const logger = createChildLogger(baseLogger, {
        userId: userFile.userId,
        fileId: userFile.fileId,
      });
      logger.error({
        event: 'user_file_create_error',
        err: serializeError(err),
        message: 'Failed to create user file',
      });
      throw err;
    }
  }

  /**
   * Gets role permissions from DynamoDB
   */
  async getRolePermissions(
    roleId: string,
    organizationId: string,
  ): Promise<any[]> {
    const logger = createChildLogger(baseLogger, { roleId, organizationId });
    const ROLES_TABLE = process.env.ROLES_TABLE;
    try {
      const params = {
        TableName: ROLES_TABLE,
        Key: {
          PK: `ORG#${organizationId}`,
          SK: `ROLE#${roleId}`,
        },
      };
      const result = await sendDoc<GetCommandOutput>(docClient,
        new GetCommand(params),
      );
      if (result.Item) {
        logger.info({ event: 'getRolePermissions_success', roleId });
        return [result.Item];
      }
      return [];
    } catch (err) {
      logger.error({
        event: 'getRolePermissions_error',
        err: serializeError(err),
      });
      return [];
    }
  }

  /**
   * Gets currencies for a country code from DynamoDB
   * getCurrenciesForCountryCode
   */
  async getCurrenciesForCountryCode(countryCode: string): Promise<any[]> {
    const logger = createChildLogger(baseLogger, { countryCode });
    const PACKAGE_TABLE = process.env.PACKAGE_TABLE;
    try {
      if (!countryCode) {
        return [];
      }

      const params = {
        TableName: PACKAGE_TABLE,
        KeyConditionExpression: '#pk = :pk AND #sk = :sk',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': 'CURRENCIES',
          ':sk': `COUNTRY#${countryCode}`,
        },
      };

      const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      if (
        result.Items &&
        result.Items.length > 0 &&
        Array.isArray(result.Items[0].currencies)
      ) {
        logger.info({
          event: 'getCurrenciesForCountryCode_success',
          countryCode,
        });
        return result.Items[0].currencies;
      }
      return [];
    } catch (err) {
      logger.error({
        event: 'getCurrenciesForCountryCode_error',
        err: serializeError(err),
      });
      return [];
    }
  }

  /**
   * Gets user preferences (for schedule configuration)
   *
   */
  async getUserPreferences(
    userId: string,
    organizationId: string,
  ): Promise<any> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    try {
      const params = {
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'PREFERENCE',
        },
      };

      const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      if (result.Items && result.Items.length > 0) {
        const item = result.Items[0];
        // Filter out metadata fields
        const {
          pk,
          sk,
          userID,
          createdDate,
          modifiedDate,
          organizationID,
          ...rest
        } = item;
        logger.info({ event: 'getUserPreferences_success', userId });
        return rest;
      }
      return {};
    } catch (err) {
      logger.error({
        event: 'getUserPreferences_error',
        err: serializeError(err),
      });
      return {};
    }
  }

  /**
   * Gets user basic details (for FNF details)
   */
  async getUserBasicDetails(userId: string): Promise<any | null> {
    const logger = createChildLogger(baseLogger, { userId });
    try {
      const params = {
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': orgSK(),
        },
      };

      const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      if (result.Items && result.Items.length > 0) {
        logger.info({ event: 'getUserBasicDetails_success', userId });
        return result.Items[0];
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

  async listUserFiles(userId: string): Promise<UserFile[]> {
    try {
      const result = await sendDoc<QueryCommandOutput>(docClient,
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
      logger.error({
        event: 'user_files_list_error',
        err: serializeError(err),
        message: 'Failed to list user files',
      });
      throw err;
    }
  }

  async listOrganizationUsers(
    organizationId: string,
    options: ListOrganizationUsersOptions = {},
  ): Promise<UserResponse[]> {
    const {
      limit,
      offset = 0,
      status,
      filter,
      specialty,
      search,
      sortBy = 'createdDate',
      sortOrder = 'desc',
      previouslyConsulted,
    } = options;
    const filterType = filter?.trim()?.toUpperCase();
    const filterTypePrefix = {
      "STAFF": 'STAFF',
      'ALL-PATIENT': 'USER',
      'ASSIGNED-PATIENT': 'ASSIGNEE',
      'LAB-PATIENT': 'LAB_PATIENT',
      'ALL': 'USER',
    };
    try {
      console.info('listOrganizationUsers', organizationId, {
        limit,
        offset,
        status,
        filter,
        specialty,
        search,
        sortBy,
        sortOrder,
        previouslyConsulted,
      });

      // First try with lowercase key names (pk/sk)
      try {
        const queryLimit =
          typeof limit === 'number' && limit > 0
            ? limit + Math.max(offset, 0)
            : undefined;

      

        const filterParts: string[] = [];
        const exprNames: Record<string, string> = {};
        const exprValues: Record<string, unknown> = {
          ':pk': `ORG#${organizationId}`,
          ':skPrefix': 'USER#',
        };
        if (filterType && filterTypePrefix[filterType as keyof typeof filterTypePrefix]) {
          const userTypeVal = filterTypePrefix[filterType as keyof typeof filterTypePrefix];
          exprNames['#ut'] = 'userType';
          exprValues[':userTypeVal'] = userTypeVal;
          filterParts.push('#ut = :userTypeVal');
        }
        if (filterType === 'ALL') {
          exprValues[':skPrefix'] = 'USER#';
        }

      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
            TableName: USER_TABLE_NAME,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
            ExpressionAttributeValues: exprValues,
            ...(filterParts.length > 0
              ? {
                  FilterExpression: filterParts.join(' AND '),
                  ExpressionAttributeNames: exprNames,
                }
              : {}),
            ...(queryLimit ? { Limit: queryLimit } : {}),
          }),
        );

        let users = (result.Items ?? []).map(mapToUserResponse);

        // In-memory filtering (for attributes not in FilterExpression)
        if (status) {
          const statusLc = status.toLowerCase();
          users = users.filter(
            (u) => String((u as any).status ?? '').toLowerCase() === statusLc,
          );
        }

        if (filterType !== 'ALL' && filterTypePrefix[filterType as keyof typeof filterTypePrefix]) {
          const filterTypeLc = String(filterTypePrefix[filterType as keyof typeof filterTypePrefix]).toLowerCase();
          users = users.filter(
            (u) => String((u as any).userType ?? '').toLowerCase() === filterTypeLc,
          );
        }

        if (specialty) {
          const specialtyLc = specialty.toLowerCase();
          users = users.filter(
            (u) =>
              String((u as any).specialty ?? '').toLowerCase() === specialtyLc,
          );
        }

        if (search) {
          const term = search.toLowerCase();
          users = users.filter((u) => {
            const fullName = String((u as any).fullName ?? '').toLowerCase();
            const firstName = String((u as any).firstName ?? '').toLowerCase();
            const lastName = String((u as any).lastName ?? '').toLowerCase();
            const emailAddress = String(
              (u as any).emailAddress ?? '',
            ).toLowerCase();
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
 
          const filterPartsFb: string[] = [];
          const exprNamesFb: Record<string, string> = {};
          const exprValuesFb: Record<string, unknown> = {
            ':pk': userOrgPk(organizationId),
            ':skPrefix': 'USER#',
          };
          if (filterType && filterTypePrefix[filterType as keyof typeof filterTypePrefix]) {
            const userTypeValFb = filterTypePrefix[filterType as keyof typeof filterTypePrefix];
            exprNamesFb['#ut'] = 'userType';
            exprValuesFb[':userTypeVal'] = userTypeValFb;
            filterPartsFb.push('#ut = :userTypeVal');
          }

          const fallbackResult = await sendDoc<QueryCommandOutput>(docClient,
            new QueryCommand({
              TableName: USER_TABLE_NAME,
              KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
              ExpressionAttributeValues: exprValuesFb,
              ...(filterPartsFb.length > 0
                ? {
                    FilterExpression: filterPartsFb.join(' AND '),
                    ExpressionAttributeNames: exprNamesFb,
                  }
                : {}),
              ...(queryLimit ? { Limit: queryLimit } : {}),
            }),
          );

          let users = (fallbackResult.Items ?? []).map(mapToUserResponse);

          if (status) {
            const statusLc = status.toLowerCase();
            users = users.filter(
              (u) => String((u as any).status ?? '').toLowerCase() === statusLc,
            );
          }

            if (filterType ) {
              const filterTypeLc = filterTypePrefix[filterType as keyof typeof filterTypePrefix].toLowerCase();
              users = users.filter(
                (u) =>
                  String((u as any).userType ?? '').toLowerCase() === filterTypeLc,
              );
            }

          if (specialty) {
            const specialtyLc = specialty.toLowerCase();
            users = users.filter(
              (u) =>
                String((u as any).specialty ?? '').toLowerCase() ===
                specialtyLc,
            );
          }

          if (search) {
            const term = search.toLowerCase();
            users = users.filter((u) => {
              const fullName = String((u as any).fullName ?? '').toLowerCase();
              const firstName = String(
                (u as any).firstName ?? '',
              ).toLowerCase();
              const lastName = String((u as any).lastName ?? '').toLowerCase();
              const emailAddress = String(
                (u as any).emailAddress ?? '',
              ).toLowerCase();
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

  /**
   * Gets user roles and permissions from USER_TABLE (matches original getUserRolesPermissions)
   * Queries: pk = USER_ROLE#orgId, sk1 = userId# using pk-sk1-index
   * Also calls API endpoint to get userPermission features
   */
  async getUserRolesPermissions(
    userId: string,
    organizationId: string,
    authHeader?: string,
  ): Promise<{
    permissions: any[];
    roles: string[];
    roleName?: string;
    userPermissions?: any[];
  }> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    try {
      let data: any[] = [];
      let nextPaginationKey: any = undefined;
      const params: any = {
        TableName: USER_TABLE_NAME,
        IndexName: 'pk-sk1-index',
        KeyConditionExpression: '#pk = :pk and begins_with(#sk1, :sk1)',
        ExpressionAttributeValues: {
          ':pk': `USER_ROLE#${organizationId}`,
          ':sk1': `${userId}#`,
        },
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk1': 'sk1',
        },
      };

      do {
        if (nextPaginationKey) {
          params.ExclusiveStartKey = nextPaginationKey;
        }
        const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
        nextPaginationKey = result.LastEvaluatedKey;
        if (result.Items && result.Items.length > 0) {
          // console.log(
            // 'getUserRolesPermissions items (pk/sk1):',
            // JSON.stringify(result.Items, null, 2),
          // );
          data = data.concat(result.Items);
        }
      } while (nextPaginationKey);

      // If nothing found, try uppercase attribute schema (PK/SK1) – common in some USER_TABLE designs.
      if (data.length === 0) {
        logger.warn({
          event: 'getUserRolesPermissions_empty_first_pass',
          message: 'No role mappings found using pk/sk1; retrying with PK/SK1',
          pk: `USER_ROLE#${organizationId}`,
          sk1Prefix: `${userId}#`,
          indexName: 'pk-sk1-index',
        });

        let nextKey2: any = undefined;
        const params2: any = {
          TableName: USER_TABLE_NAME,
          IndexName: 'pk-sk1-index',
          KeyConditionExpression: '#PK = :PK and begins_with(#SK1, :SK1)',
          ExpressionAttributeValues: {
            ':PK': `USER_ROLE#${organizationId}`,
            ':SK1': `${userId}#`,
          },
          ExpressionAttributeNames: {
            '#PK': 'PK',
            '#SK1': 'SK1',
          },
        };

        do {
          if (nextKey2) params2.ExclusiveStartKey = nextKey2;
          const r2 = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params2));
          nextKey2 = r2.LastEvaluatedKey;
          if (r2.Items && r2.Items.length > 0) {
            // console.log(
              // 'getUserRolesPermissions items (PK/SK1):',
              // JSON.stringify(r2.Items, null, 2),
            // );
            data = data.concat(r2.Items);
          }
        } while (nextKey2);
      }

      const roles: string[] = [];
      const promises: Promise<any>[] = [];
      // console.log('getUserRolesPermissions - data items count:', data.length);
      // console.log(
        // 'getUserRolesPermissions - data items:',
        // JSON.stringify(data, null, 2),
      // );
      for (const role of data) {
        if (role.roleID) {
          // console.log('Found roleID:', role.roleID);
          roles.push(role.roleID);
          promises.push(this.getRoleDetails(organizationId, role.roleID));
        } else if (role.roleId) {
          // Some items may use roleId instead of roleID
          // console.log('Found roleId:', role.roleId);
          roles.push(role.roleId);
          promises.push(this.getRoleDetails(organizationId, role.roleId));
        } else {
          // console.log(
            // 'Role item missing roleID/roleId:',
            // JSON.stringify(role, null, 2),
          // );
        }
      }

      const rolesPermissions = await Promise.all(promises);
      let roleName: string | undefined;
      const roleFeaturePermission: any[] = [];
      let userPermissions: any[] = [];

      for (const obj of rolesPermissions) {
        if (obj && obj.length > 0 && obj[0]) {
          if (obj[0].permissions) {
            roleFeaturePermission.push(obj[0].permissions);
          }
          if (obj[0].roleName) {
            roleName = obj[0].roleName;
          }
        }
      }

      // Call API endpoint to get userPermission features for the first role
      if (roles.length > 0 && authHeader) {
        try {
          logger.debug({
            event: 'calling_role_api_for_permissions',
            roleId: roles[0],
            organizationId,
          });
          const apiRoleDetails = await getRoleDetails(
            roles[0],
            organizationId,
            authHeader,
          );

          if (
            apiRoleDetails &&
            Array.isArray(apiRoleDetails) &&
            apiRoleDetails.length > 0
          ) {
            // Extract features from API response
            const roleItem =
              apiRoleDetails.find(
                (item: any) =>
                  String(item.SK || item.sk || '').startsWith(
                    `ROLE#${roles[0]}`,
                  ) ||
                  item.itemType === 'Role' ||
                  item.roleId === roles[0] ||
                  item.roleID === roles[0],
              ) || apiRoleDetails[0];

            // Get features from role item
            if (roleItem?.features) {
              if (Array.isArray(roleItem.features)) {
                userPermissions = roleItem.features;
              } else if (typeof roleItem.features === 'object') {
                userPermissions = Object.values(roleItem.features);
              }
            } else {
              // If features not in role header, filter for Feature items
              const featureItems = apiRoleDetails.filter((item: any) => {
                const sk = String(item.SK || item.sk || '');
                return (
                  item.itemType === 'Feature' ||
                  !!item.featureKey ||
                  sk.includes('#FEATURE#') ||
                  sk.startsWith('MODULE#')
                );
              });
              userPermissions = featureItems;
            }

            logger.info({
              event: 'role_api_permissions_fetched',
              roleId: roles[0],
              userPermissionsCount: userPermissions.length,
            });
          }
        } catch (apiErr) {
          logger.warn({
            event: 'role_api_call_failed',
            err: serializeError(apiErr),
            roleId: roles[0],
            organizationId,
          });
          // Continue without API permissions if call fails
        }
      }

      logger.info({
        event: 'getUserRolesPermissions_success',
        userId,
        rolesCount: roles.length,
      });
      return {
        permissions: roleFeaturePermission,
        roles,
        roleName,
        userPermissions,
      };
    } catch (err) {
      logger.error({
        event: 'getUserRolesPermissions_error',
        err: serializeError(err),
      });
      return { permissions: [], roles: [] };
    }
  }

  /**
   * Gets role details from ROLES_TABLE (matches original getRoleDetails but queries ROLES_TABLE)
   * Queries ROLES_TABLE: PK = ORG#orgId, SK begins with ROLE#roleId
   * This gets role metadata (roleName, definedRoleCode, etc.) from ROLES_TABLE
   */
  async getRoleDetails(organizationId: string, roleId: string): Promise<any[]> {
    const logger = createChildLogger(baseLogger, { organizationId, roleId });
    if (!ROLES_TABLE_NAME) {
      logger.warn({
        event: 'getRoleDetails_missing_roles_table',
        message: 'ROLES_TABLE env var is not set',
      });
      return [];
    }
    try {
      // Try PK/SK format first (standard for ROLES_TABLE)
      const params = {
        TableName: ROLES_TABLE_NAME,
        KeyConditionExpression: '#PK = :PK AND begins_with(#SK, :SK)',
        FilterExpression:
          '(attribute_not_exists(deleteFlag) OR #deleteFlag <> :deleteFlag) AND (attribute_not_exists(isActive) OR #active = :active)',
        ExpressionAttributeNames: {
          '#PK': 'PK',
          '#SK': 'SK',
          '#deleteFlag': 'deleteFlag',
          '#active': 'isActive',
        },
        ExpressionAttributeValues: {
          ':PK': `ORG#${organizationId}`,
          ':SK': `ROLE#${roleId}`,
          ':deleteFlag': '1',
          ':active': true,
        },
      };

      const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      if (result.Items && result.Items.length > 0) {
        logger.info({
          event: 'getRoleDetails_success',
          organizationId,
          roleId,
          itemsCount: result.Items.length,
        });
        return result.Items;
      }

      // Fallback: try pk/sk format (lowercase) if PK/SK didn't work
      logger.debug({
        event: 'getRoleDetails_trying_lowercase_keys',
        organizationId,
        roleId,
      });
      const fallbackParams = {
        TableName: ROLES_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
        FilterExpression:
          '(attribute_not_exists(deleteFlag) OR #deleteFlag <> :deleteFlag) AND (attribute_not_exists(isActive) OR #active = :active)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
          '#deleteFlag': 'deleteFlag',
          '#active': 'isActive',
        },
        ExpressionAttributeValues: {
          ':pk': `ORG#${organizationId}`,
          ':sk': `ROLE#${roleId}`,
          ':deleteFlag': '1',
          ':active': true,
        },
      };

      const fallbackResult = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand(fallbackParams),
      );
      if (fallbackResult.Items && fallbackResult.Items.length > 0) {
        logger.info({
          event: 'getRoleDetails_success_fallback',
          organizationId,
          roleId,
          itemsCount: fallbackResult.Items.length,
        });
        return fallbackResult.Items;
      }

      logger.warn({
        event: 'getRoleDetails_no_items_found',
        organizationId,
        roleId,
      });
      return [];
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const message = (err as { message?: string })?.message || '';
      // If PK/SK format failed, try lowercase pk/sk
      if (
        name === 'ValidationException' &&
        (message.includes('PK') ||
          message.includes('SK') ||
          message.includes('key schema'))
      ) {
        try {
          logger.debug({
            event: 'getRoleDetails_retry_lowercase',
            organizationId,
            roleId,
          });
          const retryParams = {
            TableName: ROLES_TABLE_NAME,
            KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
            FilterExpression:
              '(attribute_not_exists(deleteFlag) OR #deleteFlag <> :deleteFlag) AND (attribute_not_exists(isActive) OR #active = :active)',
            ExpressionAttributeNames: {
              '#pk': 'pk',
              '#sk': 'sk',
              '#deleteFlag': 'deleteFlag',
              '#active': 'isActive',
            },
            ExpressionAttributeValues: {
              ':pk': `ORG#${organizationId}`,
              ':sk': `ROLE#${roleId}`,
              ':deleteFlag': '1',
              ':active': true,
            },
          };
          const retryResult = await sendDoc<QueryCommandOutput>(docClient,
            new QueryCommand(retryParams),
          );
          if (retryResult.Items && retryResult.Items.length > 0) {
            logger.info({
              event: 'getRoleDetails_success_retry',
              organizationId,
              roleId,
              itemsCount: retryResult.Items.length,
            });
            return retryResult.Items;
          }
        } catch (retryErr) {
          logger.error({
            event: 'getRoleDetails_retry_error',
            err: serializeError(retryErr),
            organizationId,
            roleId,
          });
        }
      }
      logger.error({
        event: 'getRoleDetails_error',
        err: serializeError(err),
        organizationId,
        roleId,
      });
      return [];
    }
  }

  /**
   * Checks if user has completed tasks (matches original checkCompletedTasks)
   * Queries TASKS_TABLE for pending tasks
   */
  async checkCompletedTasks(userId: string): Promise<boolean> {
    const logger = createChildLogger(baseLogger, { userId });
    const TASKS_TABLE = process.env.TASKS_TABLE;
    try {
      if (!TASKS_TABLE) {
        logger.warn({ event: 'TASKS_TABLE_not_configured' });
        return true; // Default to completed if table not configured
      }

      const params = {
        TableName: TASKS_TABLE,
        IndexName: 'pk-sk1-index',
        KeyConditionExpression: '#pk = :pk and #sk = :sk',
        ExpressionAttributeValues: {
          ':pk': `TASK#${userId}`,
          ':sk': 'PENDING',
        },
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk1',
        },
      };
      const command = new QueryCommand(params);
      const result = await sendDoc<QueryCommandOutput>(docClient, command);
      const hasPendingTasks = (result.Count || 0) > 0;
      logger.info({
        event: 'checkCompletedTasks_success',
        userId,
        hasPendingTasks,
      });
      return !hasPendingTasks; // Return true if no pending tasks (completed)
    } catch (err) {
      logger.error({
        event: 'checkCompletedTasks_error',
        err: serializeError(err),
      });
      return true; // Default to completed on error
    }
  }

  /**
   * Updates emailVerified and/or phoneVerified for a user in USER_BASIC_DETAILS
   * Matches original updateUserVerification from dynamodb.js
   */
  async updateUserVerification(
    userID: string,
    organizationId: string,
    updates: { emailVerified?: boolean; phoneVerified?: boolean },
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { userID, organizationId });
    try {
      const updateExpr: string[] = [];
      const exprAttrNames: Record<string, string> = {};
      const exprAttrValues: Record<string, any> = {};

      if (typeof updates.emailVerified !== 'undefined') {
        updateExpr.push('#emailVerified = :emailVerified');
        exprAttrNames['#emailVerified'] = 'emailVerified';
        exprAttrValues[':emailVerified'] = updates.emailVerified;
      }
      if (typeof updates.phoneVerified !== 'undefined') {
        updateExpr.push('#phoneVerified = :phoneVerified');
        exprAttrNames['#phoneVerified'] = 'phoneVerified';
        exprAttrValues[':phoneVerified'] = updates.phoneVerified;
      }

      if (updateExpr.length === 0) {
        logger.warn({ event: 'updateUserVerification_no_updates' });
        return;
      }

      const params = {
        TableName: USER_TABLE_NAME,
        Key: {
          pk: `USER#${userID}`,
          sk: `USER_BASIC_DETAILS#${organizationId}`,
        },
        UpdateExpression: 'SET ' + updateExpr.join(', '),
        ExpressionAttributeNames: exprAttrNames,
        ExpressionAttributeValues: exprAttrValues,
        ReturnValues: 'UPDATED_NEW' as const,
      };

      await sendDoc<UpdateCommandOutput>(docClient, new UpdateCommand(params));
      logger.info({
        event: 'updateUserVerification_success',
        userID,
        organizationId,
      });
    } catch (err) {
      logger.error({
        event: 'updateUserVerification_error',
        err: serializeError(err),
      });
      throw err;
    }
  }

  /**
   * List all patient IDs for a doctor. Matches legacy doctor_patient_list pattern:
   * - pk=USER#doctorId, begins_with(sk, ASSIGNEE#|DIETICIAN#|HEALTHCOACH#|CAREMANAGER#) with sk1 <> INACTIVE
   * - pk=USER#doctorId, begins_with(sk, SCD_LINK#) for previously consulted (no sk1 filter)
   * Tries pk/sk first; on ValidationException (PK), retries with PK/SK for tables using uppercase key names.
   */
  async listPatientIdsForDoctor(
    doctorId: string,
  ): Promise<
    {
      patientId: string;
      patientOrgId?: string;
      previouslyConsulted?: boolean;
    }[]
  > {
    const logger = createChildLogger(baseLogger, { doctorId });
    const seen = new Set<string>();
    const result: {
      patientId: string;
      patientOrgId?: string;
      previouslyConsulted?: boolean;
    }[] = [];

    const activeLinkPrefixes = [
      'ASSIGNEE#',
      'DIETICIAN#',
      'HEALTHCOACH#',
      'CAREMANAGER#',
    ];
    for (const skPrefix of activeLinkPrefixes) {
      let lastKey: Record<string, unknown> | undefined;
      do {
        const params: QueryCommandInput = {
          TableName: USER_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
          FilterExpression: '#sk1 <> :inactive',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#sk1': 'sk1' },
          ExpressionAttributeValues: {
            ':pk': `USER#${doctorId}`,
            ':sk': skPrefix,
            ':inactive': 'INACTIVE',
          },
        };
        if (lastKey)
          params.ExclusiveStartKey = lastKey as Record<string, unknown>;

        const response = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
        const items = response.Items ?? [];
        lastKey = response.LastEvaluatedKey;

        for (const item of items) {
          const sk = (item.sk as string) || '';
          const patientId = sk.includes('#') ? sk.split('#')[1] : sk;
          if (patientId && !seen.has(patientId)) {
            seen.add(patientId);
            result.push({
              patientId,
              patientOrgId:
                (item as any).organizationID ?? (item as any).patientOrgId,
              previouslyConsulted: false,
            });
          }
        }
      } while (lastKey);
    }

    const scdPrefix = 'SCD_LINK#';
    let lastKey: Record<string, unknown> | undefined;
    do {
      const params: QueryCommandInput = {
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': `USER#${doctorId}`,
          ':sk': scdPrefix,
        },
      };
      if (lastKey)
        params.ExclusiveStartKey = lastKey as Record<string, unknown>;

      const response = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      const items = response.Items ?? [];
      lastKey = response.LastEvaluatedKey;

      for (const item of items) {
        const sk = (item.sk as string) || '';
        const patientId = sk.includes('#') ? sk.split('#')[1] : sk;
        if (patientId && !seen.has(patientId)) {
          seen.add(patientId);
          result.push({
            patientId,
            patientOrgId:
              (item as any).organizationID ?? (item as any).patientOrgId,
            previouslyConsulted: true,
          });
        }
      }
    } while (lastKey);

    logger.info({
      event: 'listPatientIdsForDoctor_success',
      doctorId,
      count: result.length,
    });
    return result;
  }

  /**
   * Find a user in an organization by email or phone (for F&F search).
   * Queries org users and filters by emailAddress or phoneNumber/phoneCode.
   */
  async findUserByEmailOrPhoneInOrg(
    organizationId: string,
    email?: string,
    phone?: string,
  ): Promise<UserResponse | null> {
    if (!email && !phone) return null;
      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': userOrgPk(organizationId),
          ':skPrefix': 'USER#',
        },
        Limit: 100,
      }),
    );
    const items = result.Items ?? [];
    const emailNorm = email ? String(email).trim().toLowerCase() : '';
    const phoneNorm = phone ? String(phone).replace(/\s/g, '') : '';
    for (const item of items) {
      const u = item as any;
      if (
        emailNorm &&
        String(u?.emailAddress ?? '').toLowerCase() === emailNorm
      ) {
        return mapToUserResponse(u);
      }
      if (phoneNorm) {
        const userPhone = [
          String(u?.phoneCode ?? ''),
          String(u?.phoneNumber ?? ''),
        ]
          .filter(Boolean)
          .join('')
          .replace(/\s/g, '');
        if (
          userPhone &&
          (userPhone === phoneNorm ||
            userPhone.endsWith(phoneNorm) ||
            phoneNorm.endsWith(userPhone))
        ) {
          return mapToUserResponse(u);
        }
      }
    }
    return null;
  }

  /**
   * Save or update doctor–patient link. Matches legacy link_unlink_user pattern:
   * pk = USER#doctorId, sk = ASSIGNEE#patientId, sk1 = ACTIVE, organizationID, createdDate, modifiedDate.
   *
   * Additionally creates a reverse mapping so we can easily fetch all assigned
   * doctors for a given patient:
   * pk = USER#patientId, sk = ASSIGNED_TO#doctorId, sk1 = ACTIVE, organizationID, createdDate, modifiedDate.
   */
  async saveDoctorPatientLink(
    doctorId: string,
    patientId: string,
    organizationId: string,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, {
      doctorId,
      patientId,
      organizationId,
    });
    const doctorPk = `USER#${doctorId}`;
    const doctorSk = `ASSIGNEE#${patientId}`;
    const patientPk = `USER#${patientId}`;
    const patientSk = `ASSIGNED_TO#${doctorId}`;
    const now = Date.now();

    // Upsert doctor -> patient link
    const existing = await sendDoc<GetCommandOutput>(docClient,
      new GetCommand({
        TableName: USER_TABLE_NAME,
        Key: { pk: doctorPk, sk: doctorSk },
      }),
    );

    if (existing.Item) {
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: { pk: doctorPk, sk: doctorSk },
          UpdateExpression: 'SET #modifiedDate = :modifiedDate, #sk1 = :sk1',
          ExpressionAttributeNames: {
            '#modifiedDate': 'modifiedDate',
            '#sk1': 'sk1',
          },
          ExpressionAttributeValues: { ':modifiedDate': now, ':sk1': 'ACTIVE' },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_updated' });
    } else {
      await sendDoc<PutCommandOutput>(docClient,
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: {
            pk: doctorPk,
            sk: doctorSk,
            sk1: 'ACTIVE',
            organizationID: organizationId,
            createdDate: now,
            modifiedDate: now,
          },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_created' });
    }

    // Upsert patient -> doctor reverse link
    const reverseExisting = await sendDoc<GetCommandOutput>(docClient,
      new GetCommand({
        TableName: USER_TABLE_NAME,
        Key: { pk: patientPk, sk: patientSk },
      }),
    );

    if (reverseExisting.Item) {
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: { pk: patientPk, sk: patientSk },
          UpdateExpression: 'SET #modifiedDate = :modifiedDate, #sk1 = :sk1',
          ExpressionAttributeNames: {
            '#modifiedDate': 'modifiedDate',
            '#sk1': 'sk1',
          },
          ExpressionAttributeValues: { ':modifiedDate': now, ':sk1': 'ACTIVE' },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_reverse_updated' });
    } else {
      await sendDoc<PutCommandOutput>(docClient,
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: {
            pk: patientPk,
            sk: patientSk,
            sk1: 'ACTIVE',
            organizationID: organizationId,
            createdDate: now,
            modifiedDate: now,
          },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_reverse_created' });
    }
  }

  /**
   * List all doctor IDs assigned to a patient.
   * Uses the reverse mapping created in saveDoctorPatientLink:
   * pk = USER#patientId, sk begins_with ASSIGNED_TO#, sk1 <> INACTIVE.
   */
  async listAssignedDoctorIdsForPatient(
    patientId: string,
  ): Promise<
    {
      doctorId: string;
      organizationID?: string;
    }[]
  > {
    const logger = createChildLogger(baseLogger, { patientId });
    const result: { doctorId: string; organizationID?: string }[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const params: QueryCommandInput = {
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        FilterExpression: '#sk1 <> :inactive',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#sk1': 'sk1' },
        ExpressionAttributeValues: {
          ':pk': `USER#${patientId}`,
          ':skPrefix': 'ASSIGNED_TO#',
          ':inactive': 'INACTIVE',
        },
      };
      if (lastKey) {
        params.ExclusiveStartKey = lastKey as Record<string, unknown>;
      }

      const response = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      const items = response.Items ?? [];
      lastKey = response.LastEvaluatedKey;

      for (const item of items) {
        const sk = (item.sk as string) || '';
        const doctorId =
          sk.includes('#') && sk.split('#')[1] ? sk.split('#')[1] : sk;
        if (!doctorId) continue;

        result.push({
          doctorId,
          organizationID: (item as any).organizationID,
        });
      }
    } while (lastKey);

    logger.info({
      event: 'listAssignedDoctorIdsForPatient_success',
      patientId,
      count: result.length,
    });
    return result;
  }

  /**
   * Update patient record with reporter (doctor) info. Matches legacy updateUserBasicDetails.
   * Updates both ORG#orgId/USER#patientId (api-hub) and USER#patientId/USER_BASIC_DETAILS#orgId (legacy).
   */
  async updatePatientReporter(
    patientId: string,
    organizationId: string,
    reporter: {
      reporterId: string;
      reporterName: string;
      reporterProfilePic?: string;
      reporterEmail?: string;
    },
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { patientId, organizationId });
    const now = Date.now();
    const exprNames: Record<string, string> = {
      '#modifiedDate': 'modifiedDate',
      '#reporterId': 'reporterId',
      '#reporterName': 'reporterName',
    };
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': now,
      ':reporterId': reporter.reporterId,
      ':reporterName': reporter.reporterName,
    };
    let updateExpr =
      'SET #modifiedDate = :modifiedDate, #reporterId = :reporterId, #reporterName = :reporterName';
    if (reporter.reporterProfilePic !== undefined) {
      exprNames['#reporterProfilePic'] = 'reporterProfilePic';
      exprValues[':reporterProfilePic'] = reporter.reporterProfilePic;
      updateExpr += ', #reporterProfilePic = :reporterProfilePic';
    }
    if (reporter.reporterEmail !== undefined) {
      exprNames['#reporterEmail'] = 'reporterEmail';
      exprValues[':reporterEmail'] = reporter.reporterEmail;
      updateExpr += ', #reporterEmail = :reporterEmail';
    }

    const updates = {
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      UpdateExpression: updateExpr,
    };

    try {
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: { pk: userOrgPk(organizationId), sk: userPk(patientId) },
          ...updates,
        }),
      );
      logger.info({ event: 'updatePatientReporter_org_user' });
    } catch (err) {
      logger.warn({
        event: 'updatePatientReporter_org_user_failed',
        err: serializeError(err),
      });
    }

    try {
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userPk(patientId),
            sk: `USER_BASIC_DETAILS#${organizationId}`,
          },
          ...updates,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      logger.info({ event: 'updatePatientReporter_legacy' });
    } catch (err: unknown) {
      if (
        (err as { name?: string })?.name !== 'ConditionalCheckFailedException'
      ) {
        logger.warn({
          event: 'updatePatientReporter_legacy_failed',
          err: serializeError(err),
        });
      }
    }
  }

  /**
   * Update recent invite details for a user
   * Updates the inviteDetails attribute in the user table
   */
  async updateRecentInvite(
    userId: string,
    organizationId: string,
    options: { email?: boolean; sms?: boolean },
  ): Promise<{
    email: boolean;
    emailUpdatedAt: string;
    sms: boolean;
    smsUpdatedAt: string;
  }> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    const currentTimestamp = new Date().toISOString();

    // Get existing inviteDetails if any
    let existingInviteDetails: {
      email?: boolean;
      emailUpdatedAt?: string;
      sms?: boolean;
      smsUpdatedAt?: string;
    } = {};

    
    try {
      const getResponse = await sendDoc<GetCommandOutput>(docClient,
        new GetCommand({
          TableName: USER_TABLE_NAME,
          Key: {
            pk: userOrgPk(organizationId),
            sk: userPk(userId),
          },
        }),
      );
      if (getResponse.Item?.inviteDetails) {
        existingInviteDetails = getResponse.Item.inviteDetails as typeof existingInviteDetails;
      }
    } catch (err) {
      logger.debug({
        event: 'get_invite_details_error',
        message: 'Could not fetch existing inviteDetails, will create new',
        err: serializeError(err),
      });
    }

    // Merge existing with updates
    const inviteDetails = {
      ...existingInviteDetails,
    };

    const now = Date.now();

    // Validate email update - check if 24 hours have passed since last update
    if (options.email !== undefined && options.email === true) {
      if (existingInviteDetails.emailUpdatedAt) {
        const lastEmailUpdate = new Date(existingInviteDetails.emailUpdatedAt).getTime();
        const hoursSinceUpdate = (now - lastEmailUpdate) / (1000 * 60 * 60);

        if (hoursSinceUpdate < 24) {
          logger.warn({
            event: 'email_invite_update_too_soon',
            lastUpdatedAt: existingInviteDetails.emailUpdatedAt,
            hoursSinceUpdate: hoursSinceUpdate.toFixed(2),
          });
          throw new InviteUpdateTooSoonError(
            'email',
            existingInviteDetails.emailUpdatedAt,
            hoursSinceUpdate
          );
        }
      }
      // Allow update if emailUpdatedAt doesn't exist (first time setting)
      inviteDetails.email = options.email;
      inviteDetails.emailUpdatedAt = currentTimestamp;
      inviteDetails.sms = false;
    }

    // Validate sms update - check if 24 hours have passed since last update
    if (options.sms !== undefined && options.sms === true) {
      if (existingInviteDetails.smsUpdatedAt) {
        const lastSmsUpdate = new Date(existingInviteDetails.smsUpdatedAt).getTime();
        const hoursSinceUpdate = (now - lastSmsUpdate) / (1000 * 60 * 60);

        if (hoursSinceUpdate < 24) {
          logger.warn({
            event: 'sms_invite_update_too_soon',
            lastUpdatedAt: existingInviteDetails.smsUpdatedAt,
            hoursSinceUpdate: hoursSinceUpdate.toFixed(2),
          });
          throw new InviteUpdateTooSoonError(
            'sms',
            existingInviteDetails.smsUpdatedAt,
            hoursSinceUpdate
          );
        }
      }
      // Allow update if smsUpdatedAt doesn't exist (first time setting)
      inviteDetails.sms = options.sms;
      inviteDetails.smsUpdatedAt = currentTimestamp;
      inviteDetails.email = false;
    }

    // Handle setting to false (no time restriction)
    if (options.email !== undefined && options.email === false) {
      inviteDetails.email = false;
      // Don't update emailUpdatedAt when setting to false
      if (!existingInviteDetails.emailUpdatedAt) {
        inviteDetails.emailUpdatedAt = currentTimestamp;
      }
    }

    if (options.sms !== undefined && options.sms === false) {
      inviteDetails.sms = false;
      // Don't update smsUpdatedAt when setting to false
      if (!existingInviteDetails.smsUpdatedAt) {
        inviteDetails.smsUpdatedAt = currentTimestamp;
      }
    }

    // Ensure all required fields are present
    const finalInviteDetails = {
      email: inviteDetails.email ?? false,
      emailUpdatedAt: inviteDetails.emailUpdatedAt ?? '0000-00-00 00:00:00',
      sms: inviteDetails.sms ?? false,
      smsUpdatedAt: inviteDetails.smsUpdatedAt ?? '0000-00-00 00:00:00',
    };

    // Build update expression
    const updateParts: string[] = ['modifiedDate = :modifiedDate'];
    const exprNames: Record<string, string> = {
      '#inviteDetails': 'inviteDetails',
    };
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': Date.now(),
      ':inviteDetails': finalInviteDetails,
    };

    updateParts.push('#inviteDetails = :inviteDetails');
    try {
      await sendDoc<UpdateCommandOutput>(docClient,
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

      logger.info({
        event: 'invite_details_updated',
        message: 'Invite details updated successfully',
        inviteDetails: finalInviteDetails,
      });

      return finalInviteDetails;
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new UserNotFoundError(userId);
      }
      logger.error({
        event: 'update_invite_details_error',
        err: serializeError(err),
        message: 'Failed to update invite details',
      });
      throw err;
    }
  }
}