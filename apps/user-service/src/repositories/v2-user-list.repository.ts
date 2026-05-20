import {
  BatchGetCommand,
  BatchGetCommandOutput,
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { sendDoc } from '../utils/dynamodb-send';
import {
  createLogger,
  serializeError,
  createChildLogger,
} from '@api-hub/observability';
import type {
  UserListContext,
  V2UserListFilters,
  V2UserListPagination,
  V2UserListSort,
} from '../types/user-list-context.enum';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const USER_TABLE_NAME = process.env.USER_TABLE || '';

export interface V2UserListQueryResult {
  items: Record<string, unknown>[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface V2UserListQueryParams {
  organizationId: string;
  context: UserListContext;
  filters?: V2UserListFilters;
  pagination?: V2UserListPagination;
  sort?: V2UserListSort;
  correlationId?: string;
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function decodeCursor(cursor: string): Record<string, unknown> | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildFilterExpression(
  filters: V2UserListFilters,
  exprNames: Record<string, string>,
  exprValues: Record<string, unknown>,
): string[] {
  const filterParts: string[] = [];

  if (filters.userTypes && filters.userTypes.length > 0) {
    const userTypePlaceholders = filters.userTypes.map(
      (_, idx) => `:userType${idx}`,
    );
    filters.userTypes.forEach((ut, idx) => {
      exprValues[`:userType${idx}`] = ut.toUpperCase();
    });
    exprNames['#userType'] = 'userType';
    filterParts.push(`#userType IN (${userTypePlaceholders.join(', ')})`);
  }

  if (filters.roleCodes && filters.roleCodes.length > 0) {
    const roleCodePlaceholders = filters.roleCodes.map(
      (_, idx) => `:roleCode${idx}`,
    );
    filters.roleCodes.forEach((rc, idx) => {
      exprValues[`:roleCode${idx}`] = rc;
    });
    exprNames['#definedRoleCode'] = 'definedRoleCode';
    filterParts.push(
      `#definedRoleCode IN (${roleCodePlaceholders.join(', ')})`,
    );
  }

  if (typeof filters.isActive === 'boolean') {
    exprNames['#isActive'] = 'isActive';
    exprValues[':isActive'] = filters.isActive;
    filterParts.push('#isActive = :isActive');
  }

  if (typeof filters.isRpmUser === 'boolean') {
    exprNames['#isRpmUser'] = 'isRpmUser';
    exprValues[':isRpmUser'] = filters.isRpmUser;
    filterParts.push('#isRpmUser = :isRpmUser');
  }

  if (filters.status) {
    exprNames['#status'] = 'status';
    exprValues[':status'] = filters.status.toUpperCase() === 'ACTIVE';
    filterParts.push('#status = :status');
  }

  filterParts.push(
    '(attribute_not_exists(#isDeleted) OR #isDeleted <> :deletedTrue)',
  );
  exprNames['#isDeleted'] = 'isDeleted';
  exprValues[':deletedTrue'] = true;

  return filterParts;
}

function applySearchFilter(
  items: Record<string, unknown>[],
  search: string,
): Record<string, unknown>[] {
  const searchLower = search.toLowerCase();
  return items.filter((item) => {
    const fullName = String(item.fullName ?? '').toLowerCase();
    const emailAddress = String(item.emailAddress ?? '').toLowerCase();
    const phoneNumber = String(item.phoneNumber ?? '').toLowerCase();
    const firstName = String(item.firstName ?? '').toLowerCase();
    const lastName = String(item.lastName ?? '').toLowerCase();

    return (
      fullName.includes(searchLower) ||
      emailAddress.includes(searchLower) ||
      phoneNumber.includes(searchLower) ||
      firstName.includes(searchLower) ||
      lastName.includes(searchLower)
    );
  });
}

function sortItems(
  items: Record<string, unknown>[],
  sort?: V2UserListSort,
): Record<string, unknown>[] {
  const field = sort?.field || 'createdDate';
  const order = sort?.order || 'DESC';
  const direction = order === 'ASC' ? 1 : -1;

  return [...items].sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1 * direction;
    if (bVal == null) return -1 * direction;

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * direction;
    }

    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    if (aStr < bStr) return -1 * direction;
    if (aStr > bStr) return 1 * direction;
    return 0;
  });
}

export class V2UserListRepository {
  async queryOrganizationUsers(
    params: V2UserListQueryParams,
  ): Promise<V2UserListQueryResult> {
    const { organizationId, filters, pagination, sort, correlationId } = params;
    const logger = createChildLogger(baseLogger, {
      correlationId,
      organizationId,
    });

    logger.info({ event: 'v2_user_list_query_start', organizationId });

    const limit = pagination?.limit || 20;
    const exclusiveStartKey = pagination?.cursor
      ? decodeCursor(pagination.cursor)
      : undefined;

    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {
      ':pk': `ORG#${organizationId}`,
      ':skPrefix': 'USER#',
    };

    const filterParts = filters
      ? buildFilterExpression(filters, exprNames, exprValues)
      : ['(attribute_not_exists(#isDeleted) OR #isDeleted <> :deletedTrue)'];

    if (!filters) {
      exprNames['#isDeleted'] = 'isDeleted';
      exprValues[':deletedTrue'] = true;
    }

    const queryParams: QueryCommandInput = {
      TableName: USER_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: exprValues,
      ...(Object.keys(exprNames).length > 0 && {
        ExpressionAttributeNames: exprNames,
      }),
      ...(filterParts.length > 0 && {
        FilterExpression: filterParts.join(' AND '),
      }),
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    };

    try {
      let allItems: Record<string, unknown>[] = []; 

      const result = await sendDoc<QueryCommandOutput>(
        docClient,
        new QueryCommand(queryParams),
      );
      allItems = (result.Items ?? []) as Record<string, unknown>[];
      const lastKey = result.LastEvaluatedKey;

      if (filters?.search) {
        allItems = applySearchFilter(allItems, filters.search);
      }

      allItems = sortItems(allItems, sort);

      const paginatedItems = allItems.slice(0, limit);
      const hasMore = allItems.length > limit || !!lastKey;

      let nextKey: Record<string, unknown> | undefined;
      if (hasMore && paginatedItems.length > 0) {
        const lastItem = paginatedItems[paginatedItems.length - 1];
        nextKey = {
          pk: lastItem.pk,
          sk: lastItem.sk,
        };
      }

      logger.info({
        event: 'v2_user_list_query_success',
        count: paginatedItems.length,
        hasMore,
      });

      return {
        items: paginatedItems,
        lastEvaluatedKey: nextKey,
      };
    } catch (err) {
      const name = (err as { name?: string }).name;
      const message = (err as { message?: string }).message || '';

      if (name === 'ValidationException' && message.includes('PK')) {
        logger.info({ event: 'v2_user_list_retry_uppercase_keys' });

        const uppercaseParams: QueryCommandInput = {
          ...queryParams,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        };

        try {
          const fallbackResult = await sendDoc<QueryCommandOutput>(
            docClient,
            new QueryCommand(uppercaseParams),
          );
          let allItems = (fallbackResult.Items ?? []) as Record<
            string,
            unknown
          >[];

          if (filters?.search) {
            allItems = applySearchFilter(allItems, filters.search);
          }

          allItems = sortItems(allItems, sort);

          const paginatedItems = allItems.slice(0, limit);
          const hasMore =
            allItems.length > limit || !!fallbackResult.LastEvaluatedKey;

          let nextKey: Record<string, unknown> | undefined;
          if (hasMore && paginatedItems.length > 0) {
            const lastItem = paginatedItems[paginatedItems.length - 1];
            nextKey = {
              pk: lastItem.pk || lastItem.PK,
              sk: lastItem.sk || lastItem.SK,
            };
          }

          return {
            items: paginatedItems,
            lastEvaluatedKey: nextKey,
          };
        } catch (fallbackErr) {
          logger.error({
            event: 'v2_user_list_query_fallback_error',
            err: serializeError(fallbackErr),
          });
          throw fallbackErr;
        }
      }

      logger.error({
        event: 'v2_user_list_query_error',
        err: serializeError(err),
      });
      throw err;
    }
  }

  async queryDoctorPatients(
    doctorId: string,
    organizationId: string,
    filters?: V2UserListFilters,
    pagination?: V2UserListPagination,
    sort?: V2UserListSort,
    correlationId?: string,
  ): Promise<V2UserListQueryResult> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      doctorId,
      organizationId,
    });

    logger.info({
      event: 'v2_doctor_patients_query_start',
      doctorId,
      organizationId,
      hasFilters: !!filters,
      filters: filters
        ? {
            hasSearch: !!filters.search,
            hasUserTypes: !!filters.userTypes,
            isActive: filters.isActive,
            isRpmUser: filters.isRpmUser,
          }
        : undefined,
      pagination: pagination
        ? {
            limit: pagination.limit,
            hasCursor: !!pagination.cursor,
          }
        : undefined,
    });

    /**
     * Only active prefixes currently supported.
     * Removed:
     * - DIETICIAN#
     * - HEALTHCOACH#
     * - CAREMANAGER#
     */
    const linkPrefixes = ['ASSIGNEE#', 'SCD_LINK#'];

    try {
      /**
       * =========================================================
       * STEP 1: FETCH LINKS IN PARALLEL
       * =========================================================
       */

      const patientLinkMap = new Map<
        string,
        {
          patientId: string;
          patientOrgId?: string;
        }
      >();

      await Promise.all(
        linkPrefixes.map(async (prefix) => {
          logger.debug({
            event: 'v2_doctor_patients_query_prefix_start',
            prefix,
            doctorId,
          });

          const isScdLink = prefix === 'SCD_LINK#';

          let lastKey: Record<string, unknown> | undefined;
          let queryIteration = 0;

          do {
            queryIteration++;

            const params: QueryCommandInput = {
              TableName: USER_TABLE_NAME,
              KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
              ExpressionAttributeValues: {
                ':pk': `USER#${doctorId}`,
                ':sk': prefix,
              },
              ...(lastKey && {
                ExclusiveStartKey: lastKey,
              }),

              /**
               * Reduce payload size
               */
              ProjectionExpression: 'sk, patientOrgId, sk1',
            };

            /**
             * Preserve existing behavior.
             * SCD_LINK does not apply inactive filter.
             */
            if (!isScdLink) {
              params.FilterExpression =
                'attribute_not_exists(#sk1) OR #sk1 <> :inactive';

              params.ExpressionAttributeNames = {
                '#sk1': 'sk1',
              };

              params.ExpressionAttributeValues = {
                ...params.ExpressionAttributeValues,
                ':inactive': 'INACTIVE',
              };
            }

            const response = await sendDoc<QueryCommandOutput>(
              docClient,
              new QueryCommand(params),
            );

            const items = response.Items ?? [];

            lastKey = response.LastEvaluatedKey;

            logger.debug({
              event: 'v2_doctor_patients_link_query_result',
              prefix,
              queryIteration,
              itemsCount: items.length,
              hasLastEvaluatedKey: !!lastKey,
            });

            for (const item of items) {
              const sk = String(item.sk ?? '');

              const separatorIndex = sk.indexOf('#');

              const patientId =
                separatorIndex >= 0 ? sk.substring(separatorIndex + 1) : sk;

              if (!patientId) {
                continue;
              }

              /**
               * Preserve existing SCD_LINK behavior.
               */
              const patientOrgId =
                isScdLink && item.patientOrgId
                  ? String(item.patientOrgId)
                  : undefined;

              /**
               * O(1) duplicate handling.
               */
              if (!patientLinkMap.has(patientId)) {
                patientLinkMap.set(patientId, {
                  patientId,
                  patientOrgId,
                });
              }
            }
          } while (lastKey);
        }),
      );

      const patientLinks = Array.from(patientLinkMap.values());

      logger.info({
        event: 'v2_doctor_patients_links_collected',
        totalPatientLinks: patientLinks.length,
      });

      if (patientLinks.length === 0) {
        return {
          items: [],
          lastEvaluatedKey: undefined,
        };
      }

      /**
       * =========================================================
       * STEP 2: BATCH FETCH USERS
       * =========================================================
       */

      const BATCH_SIZE = 100;
      const chunks: typeof patientLinks[] = [];
      for (
        let i = 0;
        i < patientLinks.length;
        i += BATCH_SIZE
      ) {
        chunks.push(
          patientLinks.slice(i, i + BATCH_SIZE),
        );
      }
      
      const batchPromises = chunks.map((chunk) => {
        const keys = chunk.map((link) => ({
          pk: `ORG#${
            link.patientOrgId || organizationId
          }`,
          sk: `USER#${link.patientId}`,
        }));
      
        return sendDoc<BatchGetCommandOutput>(
          docClient,
          new BatchGetCommand({
            RequestItems: {
              [USER_TABLE_NAME]: {
                Keys: keys,
      
                /**
                 * Only fetch fields required for listing.
                 * Keeps response contract intact.
                 */
                ProjectionExpression: `
                  pk,
                  sk,
                  userID,
                  organizationID,
                  firstName,
                  lastName,
                  fullName,
                  email,
                  phoneNumber,
                  profilePic,
                  userType,
                  roleName,
                  isActive,
                  isRpmUser,
                  createdDate
                `,
              },
            },
          }),
        );
      });
      
      const batchResponses = await Promise.all(
        batchPromises,
      );
      
      const patientUsers: Record<
        string,
        unknown
      >[] = [];
      
      for (const response of batchResponses) {
        const users =
          response.Responses?.[
            USER_TABLE_NAME
          ] ?? [];
      
        patientUsers.push(
          ...(users as Record<
            string,
            unknown
          >[]),
        );
      }

      logger.info({
        event: 'v2_doctor_patients_users_fetched',
        totalPatientLinks: patientLinks.length,
        totalUsersFetched: patientUsers.length,
      });

      /**
       * =========================================================
       * STEP 3: FILTERING
       * =========================================================
       */

      let filteredUsers = patientUsers;

      if (filters?.search) {
        filteredUsers = applySearchFilter(filteredUsers, filters.search);
      }

      if (typeof filters?.isActive === 'boolean') {
        filteredUsers = filteredUsers.filter(
          (u) => u.isActive === filters.isActive,
        );
      }

      if (typeof filters?.isRpmUser === 'boolean') {
        filteredUsers = filteredUsers.filter(
          (u) => u.isRpmUser === filters.isRpmUser,
        );
      }

      if (filters?.userTypes && filters.userTypes.length > 0) {
        const allowedTypes = new Set(
          filters.userTypes.map((t) => String(t).toLowerCase()),
        );

        filteredUsers = filteredUsers.filter((u) =>
          allowedTypes.has(String(u.userType || '').toLowerCase()),
        );
      }

      /**
       * =========================================================
       * STEP 4: SORTING
       * =========================================================
       */

      filteredUsers = sortItems(filteredUsers, sort);

      /**
       * =========================================================
       * STEP 5: PAGINATION
       * =========================================================
       */

      const limit = pagination?.limit || 20;

      const paginatedItems = filteredUsers.slice(0, limit);

      const hasMore = filteredUsers.length > limit;

      let nextKey: Record<string, unknown> | undefined;

      /**
       * Preserve existing response contract.
       */
      if (hasMore && paginatedItems.length > 0) {
        const lastItem = paginatedItems[paginatedItems.length - 1];

        nextKey = {
          pk: lastItem.pk,
          sk: lastItem.sk,
        };
      }

      logger.info({
        event: 'v2_doctor_patients_query_success',
        count: paginatedItems.length,
        totalFiltered: filteredUsers.length,
        hasMore,
        limit,
      });

      return {
        items: paginatedItems,
        lastEvaluatedKey: nextKey,
      };
    } catch (err) {
      logger.error({
        event: 'v2_doctor_patients_query_error',
        doctorId,
        organizationId,
        err: serializeError(err),
      });

      throw err;
    }
  }

  async queryPatientCareTeam(
    patientId: string,
    organizationId: string,
    filters?: V2UserListFilters,
    pagination?: V2UserListPagination,
    sort?: V2UserListSort,
    correlationId?: string,
  ): Promise<V2UserListQueryResult> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      patientId,
      organizationId,
    });

    logger.info({ event: 'v2_patient_care_team_query_start', patientId });

    const careTeamIds: string[] = [];
    const linkPrefixes = [
      'ASSIGNEE#',
      'DIETICIAN#',
      'HEALTHCOACH#',
      'CAREMANAGER#',
    ];

    for (const prefix of linkPrefixes) {
      let lastKey: Record<string, unknown> | undefined;
      do {
        const params: QueryCommandInput = {
          TableName: USER_TABLE_NAME,
          IndexName: 'sk-pk-index',
          KeyConditionExpression: 'sk = :sk AND begins_with(pk, :pkPrefix)',
          FilterExpression: 'attribute_not_exists(#sk1) OR #sk1 <> :inactive',
          ExpressionAttributeNames: { '#sk1': 'sk1' },
          ExpressionAttributeValues: {
            ':sk': `${prefix}${patientId}`,
            ':pkPrefix': 'USER#',
            ':inactive': 'INACTIVE',
          },
          ...(lastKey && { ExclusiveStartKey: lastKey }),
        };

        try {
          const response = await sendDoc<QueryCommandOutput>(
            docClient,
            new QueryCommand(params),
          );
          const items = response.Items ?? [];
          lastKey = response.LastEvaluatedKey;

          for (const item of items) {
            const pk = String(item.pk ?? '');
            const staffId = pk.includes('#') ? pk.split('#')[1] : pk;
            if (staffId && !careTeamIds.includes(staffId)) {
              careTeamIds.push(staffId);
            }
          }
        } catch (gsiErr) {
          logger.warn({
            event: 'v2_patient_care_team_gsi_query_failed',
            err: serializeError(gsiErr),
          });
          break;
        }
      } while (lastKey);
    }

    if (careTeamIds.length === 0) {
      return { items: [], lastEvaluatedKey: undefined };
    }

    const careTeamUsers: Record<string, unknown>[] = [];
    for (const staffId of careTeamIds) {
      try {
        const userResult = await sendDoc<QueryCommandOutput>(
          docClient,
          new QueryCommand({
            TableName: USER_TABLE_NAME,
            KeyConditionExpression: 'pk = :pk AND sk = :sk',
            ExpressionAttributeValues: {
              ':pk': `ORG#${organizationId}`,
              ':sk': `USER#${staffId}`,
            },
            Limit: 1,
          }),
        );

        if (userResult.Items && userResult.Items.length > 0) {
          careTeamUsers.push(userResult.Items[0] as Record<string, unknown>);
        }
      } catch (err) {
        logger.warn({
          event: 'v2_patient_care_team_fetch_user_warning',
          staffId,
          err: serializeError(err),
        });
      }
    }

    let filteredUsers = careTeamUsers;

    if (filters?.search) {
      filteredUsers = applySearchFilter(filteredUsers, filters.search);
    }

    filteredUsers = sortItems(filteredUsers, sort);

    const limit = pagination?.limit || 20;
    const paginatedItems = filteredUsers.slice(0, limit);
    const hasMore = filteredUsers.length > limit;

    let nextKey: Record<string, unknown> | undefined;
    if (hasMore && paginatedItems.length > 0) {
      const lastItem = paginatedItems[paginatedItems.length - 1];
      nextKey = { pk: lastItem.pk, sk: lastItem.sk };
    }

    logger.info({
      event: 'v2_patient_care_team_query_success',
      count: paginatedItems.length,
    });

    return {
      items: paginatedItems,
      lastEvaluatedKey: nextKey,
    };
  }

  async queryStaffUsers(
    organizationId: string,
    filters?: V2UserListFilters,
    pagination?: V2UserListPagination,
    sort?: V2UserListSort,
    correlationId?: string,
  ): Promise<V2UserListQueryResult> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      organizationId,
    });

    logger.info({ event: 'v2_staff_users_query_start', organizationId });

    const modifiedFilters: V2UserListFilters = {
      ...filters,
      userTypes: ['STAFF'],
    };

    return this.queryOrganizationUsers({
      organizationId,
      context: 'CHAT_STAFF_LIST' as UserListContext,
      filters: modifiedFilters,
      pagination,
      sort,
      correlationId,
    });
  }

  async queryDoctors(
    organizationId: string,
    filters?: V2UserListFilters,
    pagination?: V2UserListPagination,
    sort?: V2UserListSort,
    correlationId?: string,
  ): Promise<V2UserListQueryResult> {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      organizationId,
    });

    logger.info({ event: 'v2_doctors_query_start', organizationId });

    const modifiedFilters: V2UserListFilters = {
      ...filters,
      userTypes: ['STAFF'],
      roleCodes: filters?.roleCodes || ['DOCTOR', 'PHYSICIAN', 'Dr'],
    };

    return this.queryOrganizationUsers({
      organizationId,
      context: 'DOCTOR_SELECTION' as UserListContext,
      filters: modifiedFilters,
      pagination,
      sort,
      correlationId,
    });
  }

  encodeCursor(key: Record<string, unknown>): string {
    return encodeCursor(key);
  }

  decodeCursor(cursor: string): Record<string, unknown> | undefined {
    return decodeCursor(cursor);
  }
}
