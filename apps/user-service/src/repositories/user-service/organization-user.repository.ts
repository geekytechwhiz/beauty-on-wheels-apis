import {
    QueryCommand, 
    } from '@aws-sdk/lib-dynamodb';
  import { ddbDocClient } from '@api-hub/utils';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { KeyBuilder } from '@api-hub/utils';
import type { UserOrganization } from '../../models';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

const USER_TABLE = process.env.USER_TABLE || '';

export class OrganizationUserRepository {
  async listUserOrganizations(userId: string): Promise<UserOrganization[]> {
    const logger = createChildLogger(baseLogger, {
      userId,
      pk: KeyBuilder.userOrgPk(userId),
      skPrefix: KeyBuilder.orgPrefix(),
    });

    try {
      const result = await ddbDocClient.send(
        new QueryCommand({
          TableName: USER_TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': KeyBuilder.userOrgPk(userId),
            ':skPrefix': KeyBuilder.orgPrefix(),
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
  ): Promise<Array<Record<string, unknown>>> {
    const logger = createChildLogger(baseLogger, { organizationId });

    const pk = KeyBuilder.orgUserPk(organizationId);
    const allUsers: Array<Record<string, unknown>> = [];
    const keyCondition = 'pk = :pk AND begins_with(sk, :skPrefix)';
    const expressionValues: Record<string, unknown> = {
      ':pk': pk,
      ':skPrefix': KeyBuilder.userPrefix(),
    };

    logger.info({ event: 'querying_users', pk, table: USER_TABLE });

    let lastKey: Record<string, unknown> | undefined;
    let useUppercaseKeys = false;

    do {
      const params: {
        TableName: string;
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
        ExclusiveStartKey?: Record<string, unknown>;
      } = {
        TableName: USER_TABLE,
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
        response = await ddbDocClient.send(new QueryCommand(params));
      } catch (innerErr: unknown) {
        const name = (innerErr as { name?: string }).name;
        const message = String(
          (innerErr as { message?: string }).message ?? '',
        );
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
      const roleId = String(user.roleID || (user as any)?.userRole[0] || '');
      const roleName = String(user?.roleName || '');
      const definedRoleCode = String(user?.definedRoleCode || roleName || '');
      const roleType = String(user.roleType || user.userType || '');

      let status = 'ACTIVE';
      if (
        user.status === false ||
        user.status === 'INACTIVE' ||
        user.isActive === false
      ) {
        status = 'INACTIVE';
      }

      if (!roleId) {
        logger.warn({ event: 'user_missing_role', userId: user.userID });
        continue;
      }

      const mapKey = `${roleId}#${status}`;

      if (roleCountMap.has(mapKey)) {
        roleCountMap.get(mapKey)!.count++;
      } else {
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

    const countRecords: Array<Record<string, unknown>> = [];

    for (const [, roleData] of roleCountMap.entries()) {
      countRecords.push({
        pk: KeyBuilder.orgUserCountPk(organizationId),
        sk: KeyBuilder.orgUserCountSk(roleData.roleId, roleData.status),
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
}

