import axios, { AxiosError } from 'axios';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import type { SchedulePreferences } from '../models/Schedule';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

/**
 * Payload sent to Schedule API Gateway (Common API Gateway swagger).
 * - fetch-availability-schedule: Lambda receives { body, userID, organizationID, userType, headers }.
 * - manage-schedule-config: Lambda receives { body, id, organizationID, headers }.
 * For server-to-server calls we pass userID and organizationID in the request body.
 */
export interface ScheduleServiceClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

/**
 * Client for the Schedule service exposed via Common API Gateway.
 * Endpoints (from Common-API-Gateway swagger):
 * - POST /fetch-availability-schedule – get schedule/availability preferences
 * - POST /manage-schedule-config – create/update schedule config (preferences)
 */
export class ScheduleServiceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ScheduleServiceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * GET schedule preferences for a user/org.
   * Calls POST /fetch-availability-schedule with body { userID, organizationID }.
   */
  async getSchedulePreferences(
    userId: string,
    organizationId: string,
    authHeader?: string,
  ): Promise<SchedulePreferences | null> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    const url = `${this.baseUrl}/fetch-availability-schedule`;
    const body = { userID: userId, organizationID: organizationId };

    logger.info({
      event: 'scheduleServiceClient_getPreferences_start',
      url,
      hasAuth: !!authHeader,
      timeoutMs: this.timeoutMs,
    });

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
      const data = response.data?.data ?? response.data ?? null;
      if (!data) {
        logger.info({
          event: 'scheduleServiceClient_getPreferences_empty',
          status: response.status,
        });
        return null;
      }
      logger.info({
        event: 'scheduleServiceClient_getPreferences_success',
        status: response.status,
        hasWorkingHours: !!(data as Record<string, unknown>)?.workingHours,
      });
      return this.normalizePreferences(data);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      const status = axiosErr?.response?.status;
      if (status === 404) {
        logger.info({
          event: 'scheduleServiceClient_getPreferences_not_found',
          status: 404,
        });
        return null;
      }
      logger.error({
        event: 'scheduleServiceClient_getPreferences_error',
        err: serializeError(err),
        status,
        responseMessage: axiosErr?.response?.data?.message,
      });
      throw err;
    }
  }

  /**
   * PUT schedule preferences for a user/org.
   * Calls POST /manage-schedule-config with body { userID, organizationID, ...prefs }.
   */
  async putSchedulePreferences(
    userId: string,
    organizationId: string,
    prefs: SchedulePreferences,
    authHeader?: string,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    const url = `${this.baseUrl}/manage-schedule-config`;
    const body = {
      userID: userId,
      organizationID: organizationId,
      ...prefs,
    };

    logger.info({
      event: 'scheduleServiceClient_putPreferences_start',
      url,
      hasAuth: !!authHeader,
      hasWorkingHours: !!prefs.workingHours,
      hasAvailability: !!prefs.availability,
      timeoutMs: this.timeoutMs,
    });

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
      logger.info({
        event: 'scheduleServiceClient_putPreferences_success',
        status: response.status,
      });
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      logger.error({
        event: 'scheduleServiceClient_putPreferences_error',
        err: serializeError(err),
        status: axiosErr?.response?.status,
        responseMessage: axiosErr?.response?.data?.message,
      });
      throw err;
    }
  }

  /**
   * Get latest active appointments for an organization.
   * When APPOINTMENT_SCHEDULES_API_URL is set (e.g. dev), calls POST /fetch/schedules with
   * { fromDate, toDate, organizationID }. Otherwise calls get-latest-active-appointments.
   * Returns appointments with userId, userPackageId, userAddonId, scheduleId, meta, patientOrgId.
   */
  async getLatestActiveAppointments(
    organizationId: string,
    authHeader?: string,
  ): Promise<Array<{
    userId: string;
    userPackageId: string | null;
    userAddonId: string | null;
    scheduleId: string;
    meta: Record<string, unknown>;
    patientOrgId: string;
  }>> {
    const logger = createChildLogger(baseLogger, { organizationId });
    const appointmentSchedulesBaseUrl = process.env.APPOINTMENT_SCHEDULES_API_URL ?? '';

    logger.info({
      event: 'scheduleServiceClient_getLatestActiveAppointments_start',
      organizationId,
      hasAuth: !!authHeader,
      useFetchSchedulesApi: !!appointmentSchedulesBaseUrl,
      appointmentSchedulesBaseUrl: appointmentSchedulesBaseUrl || undefined,
    });

    if (appointmentSchedulesBaseUrl) {
      return this.fetchSchedulesAppointments(organizationId, authHeader, appointmentSchedulesBaseUrl);
    }
    return this.getLatestActiveAppointmentsFromLegacy(organizationId, authHeader);
  }

  /**
   * Dev appointment list API: POST /fetch/schedules with fromDate, toDate, organizationID.
   * Used when APPOINTMENT_SCHEDULES_API_URL is set (e.g. dev environment).
   */
  private async fetchSchedulesAppointments(
    organizationId: string,
    authHeader: string | undefined,
    baseUrl: string,
  ): Promise<Array<{
    userId: string;
    userPackageId: string | null;
    userAddonId: string | null;
    scheduleId: string;
    meta: Record<string, unknown>;
    patientOrgId: string;
  }>> {
    const logger = createChildLogger(baseLogger, { organizationId });
    const url = `${baseUrl.replace(/\/$/, '')}/fetch/schedules`;
    const now = Date.now();
    const toDate = now + 7 * 24 * 60 * 60 * 1000; // next 7 days for "active" window
    const body = {
      fromDate: now,
      toDate,
      organizationID: organizationId,
    };

    logger.info({
      event: 'scheduleServiceClient_fetchSchedules_request',
      url,
      fromDate: now,
      toDate,
      organizationId,
      hasAuth: !!authHeader,
      timeoutMs: this.timeoutMs,
    });

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
      const data = response.data?.data?.items ?? response.data?.data ?? [];
      const items = Array.isArray(data) ? data : [data];
      let rawList = items.flatMap((item: any) => {
        const schedules = item?.schedules ?? item?.schedule;
        if (Array.isArray(schedules)) return schedules;
        if (schedules != null) return [schedules];
        return [];
      });

      logger.info({
        event: 'scheduleServiceClient_fetchSchedules_response',
        status: response.status,
        rawCount: rawList.length,
        responseIsArray: Array.isArray(response.data?.data ?? response.data),
      });
      if(!Array.isArray(rawList)){
        rawList = [...rawList];
      }
      const mapped = this.mapFetchSchedulesResponse(rawList, organizationId, logger);
      logger.info({
        event: 'scheduleServiceClient_fetchSchedules_success',
        mappedCount: mapped.length,
      });
      return mapped;
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      const status = axiosErr?.response?.status;
      if (status === 404) {
        logger.info({
          event: 'scheduleServiceClient_fetchSchedules_not_found',
          status: 404,
        });
        return [];
      }
      logger.error({
        event: 'scheduleServiceClient_fetchSchedules_error',
        err: serializeError(err),
        status,
        responseMessage: axiosErr?.response?.data?.message,
        url,
      });
      throw err;
    }
  }

  /**
   * Map /fetch/schedules response to getLatestActiveAppointments format.
   * Handles both legacy shape (pk, meta, id, participantInfo) and flat shape (userId, id, etc.).
   */
  private mapFetchSchedulesResponse(
    rawList: any[],
    defaultOrgId: string,
    logger: ReturnType<typeof createChildLogger>,
  ): Array<{
    userId: string;
    userPackageId: string | null;
    userAddonId: string | null;
    scheduleId: string;
    meta: Record<string, unknown>;
    patientOrgId: string;
  }> {
    const filtered = rawList.filter((item: any) => {
      const userId = item?.meta?.userId ?? item?.userId;
      return userId && (item?.id ?? item?.scheduleId);
    });
    const dropped = rawList.length - filtered.length;
    if (dropped > 0) {
      logger.info({
        event: 'scheduleServiceClient_mapFetchSchedules_filtered',
        rawCount: rawList.length,
        afterFilterCount: filtered.length,
        dropped,
      });
    }
    return filtered.map((item: any) => {
        const userId = item.meta?.userId ?? item.userId;
        const userPackageId = item.meta?.userPackageId ?? item.userPackageId ?? null;
        const userAddonId = item.meta?.userAddonId ?? item.userAddonId ?? null;
        const scheduleId = String(item.id ?? item.scheduleId ?? '');
        const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
        const patientOrgId =
          item.participantInfo
            ?.filter((p: any) => p.userType === 'USER')
            ?.map((p: any) => p.organizationID)
            ?.join(',') ||
          item.organizationID ||
          defaultOrgId;
        return {
          userId,
          userPackageId: userPackageId ?? null,
          userAddonId: userAddonId ?? null,
          scheduleId,
          meta: { ...meta, userId, userPackageId, userAddonId },
          patientOrgId,
        };
      });
  }

  /**
   * Legacy: get latest active appointments via get-latest-active-appointments endpoint.
   */
  private async getLatestActiveAppointmentsFromLegacy(
    organizationId: string,
    authHeader?: string,
  ): Promise<Array<{
    userId: string;
    userPackageId: string | null;
    userAddonId: string | null;
    scheduleId: string;
    meta: Record<string, unknown>;
    patientOrgId: string;
  }>> {
    const logger = createChildLogger(baseLogger, { organizationId });
    const url = `${this.baseUrl}/get-latest-active-appointments`;
    const body = { organizationID: organizationId };

    logger.info({
      event: 'scheduleServiceClient_getLatestActiveAppointments_legacy_request',
      url,
      organizationId,
      hasAuth: !!authHeader,
      timeoutMs: this.timeoutMs,
    });

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
      const data = response.data?.data ?? response.data ?? [];
      if (!Array.isArray(data)) {
        logger.warn({
          event: 'scheduleServiceClient_getLatestActiveAppointments_legacy_non_array',
          status: response.status,
          dataType: typeof response.data,
        });
        return [];
      }

      const filtered = data.filter((item: any) =>
        item.meta &&
        Object.keys(item.meta).length > 0 &&
        item.pk &&
        item.meta.userId &&
        item.pk.includes(item.meta.userId)
      );
      const mapped = filtered.map((item: any) => ({
        userId: item.meta.userId,
        userPackageId: item.meta.userPackageId || null,
        userAddonId: item.meta.userAddonId || null,
        scheduleId: item.id,
        meta: item.meta || {},
        patientOrgId: item.participantInfo
          ?.filter((p: any) => p.userType === 'USER')
          ?.map((p: any) => p.organizationID)
          ?.join(',') || '',
      }));

      logger.info({
        event: 'scheduleServiceClient_getLatestActiveAppointments_legacy_success',
        status: response.status,
        rawCount: data.length,
        mappedCount: mapped.length,
        dropped: data.length - filtered.length,
      });
      return mapped;
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      const status = axiosErr?.response?.status;
      if (status === 404) {
        logger.info({
          event: 'scheduleServiceClient_getLatestActiveAppointments_legacy_not_found',
          status: 404,
        });
        return [];
      }
      logger.error({
        event: 'scheduleServiceClient_getLatestActiveAppointments_error',
        err: serializeError(err),
        status,
        url,
        responseMessage: axiosErr?.response?.data?.message,
      });
      throw err;
    }
  }

  private normalizePreferences(data: Record<string, unknown>): SchedulePreferences {
    return {
      workingHours: data.workingHours as SchedulePreferences['workingHours'],
      slotDurationInMinutes: data.slotDurationInMinutes as number | undefined,
      availability: data.availability as SchedulePreferences['availability'],
      leaves: data.leaves as SchedulePreferences['leaves'],
      customAvailability: data.customAvailability as SchedulePreferences['customAvailability'],
      slotsFrequency: data.slotsFrequency as number | undefined,
      maxEventAllowedPerDay: data.maxEventAllowedPerDay as number | undefined,
    };
  }
}

const defaultBaseUrl = process.env.SCHEDULE_SERVICE_API_URL ?? '';
const defaultTimeoutMs = Number(process.env.SCHEDULE_SERVICE_API_TIMEOUT_MS) || 10_000;

/** Singleton instance using env SCHEDULE_SERVICE_API_URL and SCHEDULE_SERVICE_API_TIMEOUT_MS. */
export const scheduleServiceClient = defaultBaseUrl
  ? new ScheduleServiceClient({ baseUrl: defaultBaseUrl, timeoutMs: defaultTimeoutMs })
  : null;
