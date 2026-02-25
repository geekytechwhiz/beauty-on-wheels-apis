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
import { mapToActiveConsultationUser, mapToPatientListItem, mapToPastConsultationUser, mapToUserItem } from '../utils/responseMapper';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

 

export class V2UserListService {
  private repository: V2UserListRepository;

  constructor() {
    this.repository = new V2UserListRepository();
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

    const result = await this.repository.queryOrganizationUsers({
      organizationId,
      context: UserListContext.ADMIN_DASHBOARD,
      filters,
      pagination,
      sort,
      correlationId: requestId,
    });

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handleChatStaffList(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;

    const result = await this.repository.queryStaffUsers(
      organizationId,
      filters,
      pagination,
      sort,
      requestId,
    );

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handlePatientCareTeam(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;

    if (!filters?.patientId) {
      throw new Error('patientId is required for PATIENT_CARE_TEAM context');
    }

    const result = await this.repository.queryPatientCareTeam(
      filters.patientId,
      organizationId,
      filters,
      pagination,
      sort,
      requestId,
    );

    return this.buildResponse(result.items, context, result.lastEvaluatedKey, requestId);
  }

  private async handleDoctorPatients(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;

    if (!filters?.doctorId) {
      throw new Error('doctorId is required for DOCTOR_PATIENT_LIST context');
    }

    const result = await this.repository.queryDoctorPatients(
      filters.doctorId,
      organizationId,
      filters,
      pagination,
      sort,
      requestId,
    );

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

    const result = await this.repository.queryOrganizationUsers({
      organizationId,
      context: UserListContext.PAST_CONSULTATIONS,
      filters: modifiedFilters,
      pagination,
      sort,
      correlationId: requestId,
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

    const result = await this.repository.queryOrganizationUsers({
      organizationId,
      context: UserListContext.ACTIVE_CONSULTATIONS,
      filters: modifiedFilters,
      pagination,
      sort,
      correlationId: requestId,
    });

    return this.buildResponse(result.items, context,  result.lastEvaluatedKey, requestId);
  }

  private async handleDoctorSelection(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;

    const result = await this.repository.queryDoctors(
      organizationId,
      filters,
      pagination,
      sort,
      requestId,
    );

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

    const result = await this.repository.queryOrganizationUsers({
      organizationId,
      context: UserListContext.PATIENT_LIST,
      filters: modifiedFilters,
      pagination,
      sort,
      correlationId: requestId,
    });
    console.log("RESULT DATA : ",result);
    return this.buildResponse(result.items, UserListContext.PATIENT_LIST,result.lastEvaluatedKey, requestId);
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
          data: { users: items.map(mapToPatientUser) },
        } as unknown as V2UserListResponse<UserItem>;

      case UserListContext.ACTIVE_CONSULTATIONS:
        return {
          ...envelope,
          data: { users: items.map(mapToActiveConsultationUser) },
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
function mapToPatientUser(value: Record<string, unknown>, index: number, array: Record<string, unknown>[]): unknown {
  throw new Error('Function not implemented.');
}

