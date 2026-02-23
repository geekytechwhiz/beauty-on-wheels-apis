import {
  createLogger,
  serializeError,
  createChildLogger,
} from '@api-hub/logger';
import {
  UserListContext,
  V2UserListFilters,
  V2UserListPagination,
  V2UserListSort,
  V2UserListResponse,
  V2UserListMeta,
} from '../types/user-list-context.enum';
import { V2UserListRepository } from '../repositories/v2-user-list.repository';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

export interface V2UserListServiceParams {
  organizationId: string;
  context: UserListContext;
  filters?: V2UserListFilters;
  pagination?: V2UserListPagination;
  sort?: V2UserListSort;
  requestId: string;
  authUserId?: string;
  authHeader?: string;
}

interface UserItem {
  pk?: string;
  sk?: string;
  sk1?: string;
  sk2?: string;
  userID: string;
  fullName: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string;
  phoneCode: string;
  organizationID: string;
  profilePic: string;
  mrn: string;
  isActive: boolean;
  isRpmUser: boolean;
  userType: string;
  roleID: string;
  roleName: string;
  definedRoleCode: string;
  createdDate: number;
  modifiedDate: number;
  status: boolean;
  createdAt?: number;
  specialty?: string;
  department?: string;
  reporterName?: string;
  reporterProfilePic?: string;
  doctorName?: string;
  deleteFlag?: null;
  inviteDetails?: {
    email: boolean;
    emailUpdatedAt: string;
    sms: boolean;
    smsUpdatedAt: string;
  };
  [key: string]: unknown;
}

function mapToUserItem(item: Record<string, unknown>): UserItem {
  return {
    pk: item.pk != null ? String(item.pk) : undefined,
    sk: item.sk != null ? String(item.sk) : undefined,
    sk1: item.sk1 != null ? String(item.sk1) : undefined,
    sk2: item.sk2 != null ? String(item.sk2) : undefined,
    userID: String(item.userID ?? item.userId ?? ''),
    fullName: String(item.fullName ?? ''),
    firstName: String(item.firstName ?? ''),
    lastName: String(item.lastName ?? ''),
    emailAddress: String(item.emailAddress ?? ''),
    phoneNumber: String(item.phoneNumber ?? ''),
    phoneCode: String(item.phoneCode ?? ''),
    organizationID: String(item.organizationID ?? item.organizationId ?? ''),
    profilePic: String(item.profilePic ?? ''),
    mrn: String(item.mrn ?? ''),
    isActive: item.isActive !== undefined ? Boolean(item.isActive) : true,
    isRpmUser: Boolean(item.isRpmUser ?? false),
    userType: String(item.userType ?? ''),
    roleID: String(item.roleID ?? item.roleId ?? ''),
    roleName: String(item.roleName ?? ''),
    definedRoleCode: String(item.definedRoleCode ?? ''),
    createdDate: Number(item.createdDate ?? item.createdAt ?? 0),
    modifiedDate: Number(item.modifiedDate ?? 0),
    status: item.status !== undefined ? Boolean(item.status) : true,
    createdAt: item.createdAt != null ? Number(item.createdAt) : undefined,
    specialty: item.specialty ? String(item.specialty) : undefined,
    department: item.department ? String(item.department) : undefined,
    reporterName: item.reporterName != null ? String(item.reporterName) : undefined,
    reporterProfilePic: item.reporterProfilePic != null ? String(item.reporterProfilePic) : undefined,
    doctorName: item.doctorName != null ? String(item.doctorName) : undefined,
    deleteFlag: item.deleteFlag as null | undefined,
    inviteDetails: item.inviteDetails
      ? (item.inviteDetails as UserItem['inviteDetails'])
      : undefined,
  };
}

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
          return this.handleAdminDashboard(params);

        case UserListContext.CHAT_STAFF_LIST:
          return this.handleChatStaffList(params);

        case UserListContext.PATIENT_CARE_TEAM:
          return this.handlePatientCareTeam(params);

        case UserListContext.DOCTOR_PATIENT_LIST:
          return this.handleDoctorPatients(params);

        case UserListContext.PAST_CONSULTATIONS:
          return this.handlePastConsultations(params);

        case UserListContext.ACTIVE_CONSULTATIONS:
          return this.handleActiveConsultations(params);

        case UserListContext.DOCTOR_SELECTION:
          return this.handleDoctorSelection(params);

        case UserListContext.PATIENT_CHAT_LIST:
        case UserListContext.PATIENT_LIST:
          return this.handlePatientList(params);

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

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  private async handleChatStaffList(
    params: V2UserListServiceParams,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;

    const result = await this.repository.queryStaffUsers(
      organizationId,
      filters,
      pagination,
      sort,
      requestId,
    );

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  private async handlePatientCareTeam(
    params: V2UserListServiceParams,
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

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  private async handleDoctorPatients(
    params: V2UserListServiceParams,
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

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  private async handlePastConsultations(
    params: V2UserListServiceParams,
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

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  private async handleActiveConsultations(
    params: V2UserListServiceParams,
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

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  private async handleDoctorSelection(
    params: V2UserListServiceParams,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;

    const result = await this.repository.queryDoctors(
      organizationId,
      filters,
      pagination,
      sort,
      requestId,
    );

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  /**
   * Frontdesk – Patient List: list all patients of the organization.
   * Context: PATIENT_LIST or PATIENT_CHAT_LIST.
   * Respects filters; defaults: userTypes ['USER'] (patients), isActive true.
   */
  private async handlePatientList(
    params: V2UserListServiceParams,
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

    return this.buildResponse(result.items, result.lastEvaluatedKey, requestId);
  }

  private buildResponse(
    items: Record<string, unknown>[],
    lastEvaluatedKey?: Record<string, unknown>,
    requestId?: string,
  ): V2UserListResponse<UserItem> {
    const mappedItems = items.map(mapToUserItem);
    const nextCursor = lastEvaluatedKey
      ? this.repository.encodeCursor(lastEvaluatedKey)
      : null;

    const meta: V2UserListMeta = {
      requestId: requestId || '',
      timestamp: Date.now(),
      version: 'v2',
      nextCursor,
    };

    return {
      success: true,
      statusCode: 200,
      message: {
        title: 'Success',
        description: 'Users fetched successfully',
        severity: 'SUCCESS',
      },
      data: {
        items: mappedItems,
      },
      error: null,
      meta,
    };
  }
}
