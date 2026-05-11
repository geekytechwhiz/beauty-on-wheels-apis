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
  V2UserListResponse,
} from '../types/user-list-context.enum';
import {
  mapToActiveConsultationUser,
  mapToPatientListItem,
  mapToPastConsultationUser,
  mapToPatientUser,
  mapToUserItem,
} from '../utils/responseMapper';
import { scheduleServiceClient } from '../clients/scheduleService.client';
import { packageServiceClient } from '../clients/packageService.client';
import { UserService } from './user.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

 

export class V2UserListService {
  private repository: V2UserListRepository;
  private userService: UserService;

  constructor() {
    this.repository = new V2UserListRepository();
    this.userService = new UserService();
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
   * If requestedLimit is undefined, fetches all records.
   */
  private async fetchWithInternalPagination<T extends { items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }>(
    queryFn: (pagination: { limit: number; cursor?: string | null }) => Promise<T>,
    requestedLimit: number | undefined,
    currentCursor?: string | null,
    maxFetchLimit = 1000,
    maxIterations = 1000,
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const allFilteredItems: Record<string, unknown>[] = [];
    let currentPaginationCursor: string | null | undefined = currentCursor;
    let iterations = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    // If no limit specified, fetch all records (use large batch size and no iteration limit)
    const fetchAll = requestedLimit === undefined;
    const effectiveMaxIterations = fetchAll ? Number.MAX_SAFE_INTEGER : maxIterations;
    
    // Fetch in larger batches to account for F&F filtering
    const fetchLimit = fetchAll 
      ? maxFetchLimit 
      : Math.max(requestedLimit * 3, maxFetchLimit);

    // Continue fetching until we have enough items or no more data
    while (true) {
      // Check if we should continue based on limit
      if (!fetchAll && requestedLimit && allFilteredItems.length >= requestedLimit) {
        break;
      }
      
      if (iterations >= effectiveMaxIterations) {
        break;
      }

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

      // If no more data, break
      if (!result.lastEvaluatedKey) {
        break;
      }

      // If not fetching all and we have enough items, break
      if (!fetchAll && requestedLimit && allFilteredItems.length >= requestedLimit) {
        break;
      }
    }

    // Take only the requested number of items (or all if fetchAll)
    const paginatedItems = fetchAll 
      ? allFilteredItems 
      : allFilteredItems.slice(0, requestedLimit);

    // Determine if there are more items available (only if not fetching all)
    const hasMore = !fetchAll && (allFilteredItems.length > (requestedLimit || 0) || !!lastEvaluatedKey);

    // Create cursor for next page if there are more items
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

    // Pass undefined if no limit provided to fetch all records
    const requestedLimit = pagination?.limit;

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
      requestedLimit: requestedLimit || 'ALL',
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

    // Pass undefined if no limit provided to fetch all records
    const requestedLimit = pagination?.limit;

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

    // Pass undefined if no limit provided to fetch all records
    const requestedLimit = pagination?.limit;
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

    // Pass undefined if no limit provided to fetch all records
    const requestedLimit = pagination?.limit;
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
    const { organizationId, filters, sort, requestId, authHeader } = params;
    const logger = createChildLogger(baseLogger, {
      correlationId: requestId,
      organizationId,
    });

    logger.info({ event: 'v2_past_consultations_start' });

    if (!scheduleServiceClient) {
      logger.warn({
        event: 'v2_past_consultations_no_schedule_client',
        message: 'SCHEDULE_SERVICE_API_URL not configured',
      });
      return this.buildResponse([], context, undefined, requestId);
    }

    // Fetch past appointments for this organization (last 30 days window)
    let appointmentInfo: Array<{
      userId: string;
      userPackageId: string | null;
      userAddonId: string | null;
      scheduleId: string;
      meta: Record<string, unknown>;
      patientOrgId: string;
    }> = [];

    try {
      appointmentInfo = await scheduleServiceClient.getPastAppointments(
        organizationId,
        authHeader,
      );
      logger.info({
        event: 'v2_past_consultations_appointments_fetched',
        count: appointmentInfo.length,
      });
    } catch (err) {
      logger.error({
        event: 'v2_past_consultations_appointments_error',
        err: serializeError(err as Error),
      });
      throw err;
    }

    if (!appointmentInfo || appointmentInfo.length === 0) {
      logger.info({
        event: 'v2_past_consultations_no_appointments',
      });
      return this.buildResponse([], context, undefined, requestId);
    }

    // Resolve patient user data for each appointment's patient
    const patientList = await Promise.all(
      appointmentInfo.map(async (appt) => {
        try {
          const user = await this.userService.getUser(
            appt.userId,
            appt.patientOrgId || organizationId,
          );
          if (!user) return null;
          const u = user as unknown as Record<string, unknown>;
          return {
            ...u,
            previouslyConsulted: true,
          } as Record<string, unknown>;
        } catch (err) {
          logger.warn({
            event: 'v2_past_consultations_user_fetch_warning',
            userId: appt.userId,
            patientOrgId: appt.patientOrgId,
            err: serializeError(err as Error),
          });
          return null;
        }
      }),
    );

    // Filter out failed lookups and deduplicate by user + org
    const seenKeys = new Set<string>();
    const resolvedPatients: Record<string, unknown>[] = [];
    for (const p of patientList) {
      if (!p) continue;
      const patient = p as any;
      const userId =
        String(patient.userID ?? patient.userId ?? patient.patientId ?? '') || '';
      const orgId =
        String(
          patient.organizationID ??
            patient.organizationId ??
            patient.patientOrgId ??
            organizationId,
        ) || '';
      if (!userId) continue;
      const key = `${userId}#${orgId}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      resolvedPatients.push(patient);
    }

    logger.info({
      event: 'v2_past_consultations_users_resolved',
      totalAppointments: appointmentInfo.length,
      totalResolved: resolvedPatients.length,
    });

    // Apply basic filters (isActive, isRpmUser, search) and sort in-memory
    let filteredPatients = resolvedPatients;

    if (typeof filters?.isActive === 'boolean') {
      filteredPatients = filteredPatients.filter(
        (u) => (u as any).isActive === filters.isActive,
      );
    }

    if (typeof filters?.isRpmUser === 'boolean') {
      filteredPatients = filteredPatients.filter(
        (u) => (u as any).isRpmUser === filters.isRpmUser,
      );
    }

    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      filteredPatients = filteredPatients.filter((item) => {
        const fullName = String((item as any).fullName ?? '').toLowerCase();
        const emailAddress = String(
          (item as any).emailAddress ?? '',
        ).toLowerCase();
        const phoneNumber = String(
          (item as any).phoneNumber ?? '',
        ).toLowerCase();
        const firstName = String((item as any).firstName ?? '').toLowerCase();
        const lastName = String((item as any).lastName ?? '').toLowerCase();

        return (
          fullName.includes(searchLower) ||
          emailAddress.includes(searchLower) ||
          phoneNumber.includes(searchLower) ||
          firstName.includes(searchLower) ||
          lastName.includes(searchLower)
        );
      });
    }

    if (sort?.field) {
      const field = sort.field;
      const order = sort.order || 'DESC';
      const direction = order === 'ASC' ? 1 : -1;
      filteredPatients = [...filteredPatients].sort((a, b) => {
        const aVal = (a as any)[field];
        const bVal = (b as any)[field];

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

    // Filter out F&F users
    const nonFnfPatients = this.filterFriendFamilyUsers(filteredPatients);

    logger.info({
      event: 'v2_past_consultations_filtered_fnf',
      requestedLimit: undefined,
      returnedCount: nonFnfPatients.length,
    });

    // PAST_CONSULTATIONS response is not paginated today – all results are returned
    return this.buildResponse(nonFnfPatients, context, undefined, requestId);
  }

  private async handleActiveConsultations(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {

    // console.log('params', JSON.stringify(params));
    const { organizationId, requestId, authHeader } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId, organizationId });

    logger.info({ event: 'v2_active_consultations_start' });

    if (!scheduleServiceClient) {
      logger.warn({
        event: 'v2_active_consultations_no_schedule_client',
        message: 'SCHEDULE_SERVICE_API_URL not configured',
      });
      return this.buildResponse([], context, undefined, requestId);
    }

    // Fetch latest active appointments for this organization
    let appointmentInfo: Array<{
      userId: string;
      userPackageId: string | null;
      userAddonId: string | null;
      scheduleId: string;
      meta: Record<string, unknown>;
      patientOrgId: string;
    }> = [];

    try {
      appointmentInfo = await scheduleServiceClient.getLatestActiveAppointments(
        organizationId,
        authHeader,
      );
      // console.log('appointmentInfo', JSON.stringify(appointmentInfo));
      logger.info({
        event: 'v2_active_consultations_appointments_fetched',
        count: appointmentInfo.length,
      });
    } catch (err) {
      logger.error({
        event: 'v2_active_consultations_appointments_error',
        err: serializeError(err),
      });
      throw err;
    }

    if (!appointmentInfo || appointmentInfo.length === 0) {
      logger.info({
        event: 'v2_active_consultations_no_appointments',
      });
      return this.buildResponse([], context, undefined, requestId);
    }

    // Fetch user services for appointments to build activeService
    let userServices: any[] = [];
    if (packageServiceClient) {
      try {
        const serviceRequests = appointmentInfo.map((appt) => {
          const req: any = { userId: appt.userId };
          if (appt.userAddonId) req.userAddonId = appt.userAddonId;
          else if (appt.userPackageId) req.userPackageId = appt.userPackageId;
          return req;
        });
        // console.log('serviceRequests', JSON.stringify(serviceRequests));

        userServices = await packageServiceClient.getServicesByList(serviceRequests, authHeader);

        // Map schedule metadata to services
        const scheduleMetaMap = new Map<string, Record<string, unknown>>();
        appointmentInfo.forEach((appt) => {
          if (appt.scheduleId && appt.meta) {
            scheduleMetaMap.set(appt.scheduleId, appt.meta);
          }
        });

        userServices.forEach((service) => {
          if (Array.isArray(service.scheduled)) {
            service.scheduled.forEach((schedule: any) => {
              if (schedule.scheduleId && scheduleMetaMap.has(schedule.scheduleId)) {
                schedule.meta = scheduleMetaMap.get(schedule.scheduleId);
              }
            });
          }
        });
        // console.log('userServices updated', JSON.stringify(userServices));
      } catch (serviceErr) {
        logger.warn({
          event: 'v2_active_consultations_services_fetch_warning',
          err: serializeError(serviceErr as Error),
          message: 'Failed to fetch user services, continuing without activeService',
        });
      }
    } else {
      logger.warn({
        event: 'v2_active_consultations_no_package_client',
        message: 'PACKAGE_API_URL not configured',
      });
    }

    // Create map of userId -> activeService (single item, wrapped as array in mapper)
    const activeServiceMap = new Map<string, any>();
    appointmentInfo.forEach((appt) => {
      const matchingService = userServices.find((service) => {
        return (
          (appt.userAddonId && service.userAddonId === appt.userAddonId) ||
          (appt.userPackageId && service.userPackageId === appt.userPackageId)
        );
      });
      if (matchingService) {
        activeServiceMap.set(appt.userId, matchingService);
      }
    });

    // console.log('activeServiceMap', JSON.stringify(activeServiceMap));

    // Fetch user data for each appointment's patient
    const patientList = await Promise.all(
      appointmentInfo.map(async (appt) => {
        try {
          const user = await this.userService.getUser(
            appt.userId,
            appt.patientOrgId || organizationId,
          );

          const activeService = activeServiceMap.get(appt.userId);
          return {
            ...user,
            activeService: activeService ? [activeService] : [],
          } as Record<string, unknown>;
        } catch (err) {
          logger.warn({
            event: 'v2_active_consultations_user_fetch_warning',
            userId: appt.userId,
            patientOrgId: appt.patientOrgId,
            err: serializeError(err as Error),
          });
          return null;
        }
      }),
    );

    const validPatients = patientList.filter(
      (p): p is Record<string, unknown> => p !== null,
    );

    logger.info({
      event: 'v2_active_consultations_users_resolved',
      totalAppointments: appointmentInfo.length,
      validPatients: validPatients.length,
    });

    // v2 response for ACTIVE_CONSULTATIONS does not use pagination cursor today
    // so we return all resolved patients as a single page.
    return this.buildResponse(validPatients, context, undefined, requestId);
  }

  private async handleDoctorSelection(
    params: V2UserListServiceParams,
    context: UserListContext,
  ): Promise<V2UserListResponse<UserItem>> {
    const { organizationId, filters, pagination, sort, requestId } = params;
    const logger = createChildLogger(baseLogger, { correlationId: requestId });

    // Pass undefined if no limit provided to fetch all records
    const requestedLimit = pagination?.limit;

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

    // Pass undefined if no limit provided to fetch all records
    const requestedLimit = pagination?.limit;

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

      case UserListContext.PAST_CONSULTATIONS: {
        const previouslyConsultedItems = items.filter((item) =>
          Boolean((item as any).previouslyConsulted ?? false),
        );
        return {
          ...envelope,
          data: { items: previouslyConsultedItems.map(mapToPastConsultationUser) },
        } as unknown as V2UserListResponse<UserItem>;
      }

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

