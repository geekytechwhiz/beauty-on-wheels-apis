import {
  createChildLogger,
  createLogger,
  serializeError,
} from '@api-hub/logger';
import { UserItem, V2UserListServiceParams } from '../models/UserListResponse';
import { V2UserListRepository } from '../repositories/v2-user-list.repository';
import {
  UserListContext,
  V2UserListFilters,
  V2UserListMeta,
  V2UserListResponse
} from '../types/user-list-context.enum';
import { mapToActiveConsultationUser, mapToPatientListItem, mapToPastConsultationUser, mapToPatientUser, mapToUserItem } from '../utils/responseMapper';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

 

export class V2UserListService {
  private repository: V2UserListRepository;

  constructor() {
    this.repository = new V2UserListRepository();
  }

  /**
   * Filter out F&F (Friend & Family) users from the list.
   * Excludes users with definedRoleCode of 'FRIEND' or 'FAMILY'.
   */
  private filterFriendFamilyUsers(
    items: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return items.filter((item) => {
      const definedRoleCode = String(item.definedRoleCode || '').toUpperCase();
      return definedRoleCode !== 'FRIEND' && definedRoleCode !== 'FAMILY';
    });
  }

  /**
   * Handle pagination internally by fetching additional pages until we have
   * enough filtered items (excluding F&F users) to meet the requested limit.
   */
  private async fetchWithInternalPagination<T extends { items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }>(
    queryFn: (pagination: { limit: number; cursor?: string | null }) => Promise<T>,
    requestedLimit: number,
    currentCursor?: string | null,
    maxFetchLimit: number = 100,
    maxIterations: number = 10,
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const allFilteredItems: Record<string, unknown>[] = [];
    let currentPaginationCursor: string | null | undefined = currentCursor;
    let iterations = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    // Fetch in larger batches to account for F&F filtering
    const fetchLimit = Math.max(requestedLimit * 3, maxFetchLimit);

    while (allFilteredItems.length < requestedLimit && iterations < maxIterations) {
      iterations++;

      const result = await queryFn({
        limit: fetchLimit,
        cursor: currentPaginationCursor,
      });

      // Filter out F&F users
      const filteredBatch = this.filterFriendFamilyUsers(result.items);
      allFilteredItems.push(...filteredBatch);

      // Update cursor for next iteration
      lastEvaluatedKey = result.lastEvaluatedKey;
      currentPaginationCursor = result.lastEvaluatedKey
        ? this.repository.encodeCursor(result.lastEvaluatedKey)
        : null;

      // If no more data or we have enough items, break
      if (!result.lastEvaluatedKey || allFilteredItems.length >= requestedLimit) {
        break;
      }
    }

    // Take only the requested number of items
    const paginatedItems = allFilteredItems.slice(0, requestedLimit);

    // Determine if there are more items available
    // We have more if: we collected more than requested, OR there's more data in the DB
    const hasMore = allFilteredItems.length > requestedLimit || !!lastEvaluatedKey;

    // Create cursor for next page if there are more items
    // Use the last item from our filtered results to create the cursor
    let nextCursor: Record<string, unknown> | undefined;
    if (hasMore && paginatedItems.length > 0) {
      const lastItem = paginatedItems[paginatedItems.length - 1];
      // Create cursor from the last returned item (same format as repository)
      nextCursor = {
        pk: lastItem.pk || lastItem.PK,
        sk: lastItem.sk || lastItem.SK,
      };
    } else if (hasMore && lastEvaluatedKey) {
      // If we don't have items but there's more data, use the repository's cursor
      nextCursor = lastEvaluatedKey;
    }

    return {
      items: paginatedItems,
      lastEvaluatedKey: nextCursor,
    };
  }

  async listUsers(
    params: V2UserListServiceParams,
  ): Promise<V2UserListResponse<UserItem>> {
    const { context, requestId } = params;
    const logger = createChildLogger(baseLogger, {
      correlationId: requestId,
      context,
      organizationId: params.organizationId,
    });

    logger.info({ event: 'v2_user_list_service_start', context });

    try {
      switch (context) {
        case UserListContext.ADMIN_DASHBOARD:
          return this.handleAdminDashboard(params, context);

        case UserListContext.CHAT_STAFF_LIST:
          return this.handleChatStaffList(params, context);

        case UserListContext.PATIENT_CARE_TEAM:
          return this.handlePatientCareTeam(params, context);

        case UserListContext.DOCTOR_PATIENT_LIST:
          return this.handleDoctorPatients(params, context);

        case UserListContext.PAST_CONSULTATIONS:
          return this.handlePastConsultations(params, context);

        case UserListContext.ACTIVE_CONSULTATIONS:
          return this.handleActiveConsultations(params, context);

        case UserListContext.DOCTOR_SELECTION:
          return this.handleDoctorSelection(params, context);

        case UserListContext.PATIENT_CHAT_LIST:
        case UserListContext.PATIENT_LIST:
          return this.handlePatientList(params, context);

        default:
          throw new Error(`Invalid context: ${context}`);
      }
    } catch (err) {
      logger.error({
        event: 'v2_user_list_service_error',
        err: serializeError(err),
      });
      throw err;
    }
  }

  private async handleAdminDashboard(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    const requestedLimit = pagination?.limit || 20;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryOrganizationUsers({
          organizationId,
          context: UserListContext.ADMIN_DASHBOARD,
          filters,
          pagination: paginationParams,
          sort,
          correlationId: requestId,
        });
      },
      requestedLimit,
      pagination?.cursor,
    );

    logger.info({ 
      event: 'v2_admin_dashboard_filtered_fnf', 
      requestedLimit,
      returnedCount: result.items.length,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handleChatStaffList(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    const requestedLimit = pagination?.limit || 20;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryStaffUsers(
          organizationId,
          filters,
          paginationParams,
          sort,
          requestId,
        );
      },
      requestedLimit,
      pagination?.cursor,
    );

    logger.info({ 
      event: 'v2_chat_staff_list_filtered_fnf', 
      requestedLimit,
      returnedCount: result.items.length,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handlePatientCareTeam(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    if (!filters?.patientId) {
      throw new Error('patientId is required for PATIENT_CARE_TEAM context');
    }

    const requestedLimit = pagination?.limit || 20;
    const patientId = filters.patientId;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryPatientCareTeam(
          patientId,
          organizationId,
          filters,
          paginationParams,
          sort,
          requestId,
        );
      },
      requestedLimit,
      pagination?.cursor,
    );

    logger.info({ 
      event: 'v2_patient_care_team_filtered_fnf', 
      patientId: filters.patientId,
      requestedLimit,
      returnedCount: result.items.length,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handleDoctorPatients(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    if (!filters?.doctorId) {
      throw new Error('doctorId is required for DOCTOR_PATIENT_LIST context');
    }

    const requestedLimit = pagination?.limit || 20;
    const doctorId = filters.doctorId;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryDoctorPatients(
          doctorId,
          organizationId,
          filters,
          paginationParams,
          sort,
          requestId,
        );
      },
      requestedLimit,
      pagination?.cursor,
    );

    logger.info({ 
      event: 'v2_doctor_patient_list_filtered_fnf', 
      doctorId: filters.doctorId,
      requestedLimit,
      returnedCount: result.items.length,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handlePastConsultations(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    logger.info({ event: 'v2_past_consultations_start' });

    const modifiedFilters: V2UserListFilters = {
      ...filters,
      userTypes: ['USER'],
    };

    const requestedLimit = pagination?.limit || 20;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryOrganizationUsers({
          organizationId,
          context: UserListContext.PAST_CONSULTATIONS,
          filters: modifiedFilters,
          pagination: paginationParams,
          sort,
          correlationId: requestId,
        });
      },
      requestedLimit,
      pagination?.cursor,
    );

    logger.info({ 
      event: 'v2_past_consultations_filtered_fnf', 
      requestedLimit,
      returnedCount: result.items.length,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handleActiveConsultations(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    logger.info({ event: 'v2_active_consultations_start' });

    const modifiedFilters: V2UserListFilters = {
      ...filters,
      userTypes: ['USER'],
      isActive: true,
    };

    const requestedLimit = pagination?.limit || 20;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryOrganizationUsers({
          organizationId,
          context: UserListContext.ACTIVE_CONSULTATIONS,
          filters: modifiedFilters,
          pagination: paginationParams,
          sort,
          correlationId: requestId,
        });
      },
      requestedLimit,
      pagination?.cursor,
    );

    logger.info({ 
      event: 'v2_active_consultations_filtered_fnf', 
      requestedLimit,
      returnedCount: result.items.length,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handleDoctorSelection(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    const requestedLimit = pagination?.limit || 20;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryDoctors(
          organizationId,
          filters,
          paginationParams,
          sort,
          requestId,
        );
      },
      requestedLimit,
      pagination?.cursor,
    );

    logger.info({ 
      event: 'v2_doctor_selection_filtered_fnf', 
      requestedLimit,
      returnedCount: result.items.length,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  /**
   * Frontdesk – Patient List: list all patients of the organization.
   * Context: PATIENT_LIST or PATIENT_CHAT_LIST.
   * Respects filters; defaults: userTypes ['USER'] (patients), isActive true.
   */
  private async handlePatientList(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    logger.info({ event: 'v2_patient_list_start', context: params.context });

    const modifiedFilters: V2UserListFilters = {
      ...filters,
      userTypes:
        filters?.userTypes && filters.userTypes.length > 0
          ? filters.userTypes
          : ['USER'],
      isActive: filters?.isActive !== undefined ? filters.isActive : true,
    };

    const requestedLimit = pagination?.limit || 20;

    const result = await this.fetchWithInternalPagination(
      async (paginationParams) => {
        return this.repository.queryOrganizationUsers({
          organizationId,
          context: UserListContext.PATIENT_LIST,
          filters: modifiedFilters,
          pagination: paginationParams,
          sort,
          correlationId: requestId,
        });
      },
      requestedLimit,
      pagination?.cursor,
    );
    
    logger.info({ 
      event: 'v2_patient_list_filtered_fnf', 
      requestedLimit,
      returnedCount: result.items.length,
    });
    
    return this.buildResponse(result.items, UserListContext.PATIENT_LIST, result.lastEvaluatedKey, requestId);
  }

  private buildEnvelope(
    lastEvaluatedKey: Record<string, unknown> | undefined,
    requestId: string | undefined,
  ): { success: true; statusCode: 200; message: V2UserListResponse<UserItem>['message']; error: null; meta: V2UserListMeta } {
    const timestamp = new Date().toISOString();
    return {
      success: true,
      statusCode: 200,
      message: {
        title: 'Success',
        description: 'Users fetched successfully',
        severity: 'SUCCESS',
      },
      error: null,
      meta: {
        requestId: requestId ?? '',
        timestamp,
        version: 'v2',
        nextCursor: lastEvaluatedKey ? this.repository.encodeCursor(lastEvaluatedKey) : null,
      },
    };
  }

  private buildResponse(
    items: Record<string, unknown>[],
    context: UserListContext,
    lastEvaluatedKey?: Record<string, unknown>,
    requestId?: string,
  ): V2UserListResponse<UserItem> {
    const envelope = this.buildEnvelope(lastEvaluatedKey, requestId);

    switch (context) {
      case UserListContext.ADMIN_DASHBOARD:
      case UserListContext.CHAT_STAFF_LIST:
      case UserListContext.DOCTOR_SELECTION:
        return {
          ...envelope,
          data: { items: items.map(mapToUserItem) },
        };

      case UserListContext.PATIENT_LIST:
        return {
          ...envelope,
          data: { items: items.map(mapToPatientListItem) },
        };

      case UserListContext.PATIENT_CHAT_LIST:
        return {
          ...envelope,
          data: { items: items.map(mapToUserItem) },
        };

      case UserListContext.PAST_CONSULTATIONS:
        return {
          ...envelope,
          data: { users: items.map(mapToPastConsultationUser) },
        } as unknown as V2UserListResponse<UserItem>;

      case UserListContext.DOCTOR_PATIENT_LIST:
        return {
          ...envelope,
          data: { items: items.map(mapToPatientUser) },
        } as unknown as V2UserListResponse<UserItem>;

      case UserListContext.ACTIVE_CONSULTATIONS:
        return {
          ...envelope,
          data: { items: items.map(mapToActiveConsultationUser) },
        } as unknown as V2UserListResponse<UserItem>;

      case UserListContext.PATIENT_CARE_TEAM:
        return {
          ...envelope,
          data: { items: items.map(mapToUserItem) },
        };

      default:
        throw new Error(`Invalid context: ${context}`);
    }
  }
}

