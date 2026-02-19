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

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
      const data = response.data?.data ?? response.data ?? null;
      if (!data) return null;
      return this.normalizePreferences(data);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      const status = axiosErr?.response?.status;
      if (status === 404) return null;
      logger.error({
        event: 'scheduleServiceClient_getPreferences_error',
        err: serializeError(err),
        status,
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

    try {
      await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
    } catch (err) {
      logger.error({
        event: 'scheduleServiceClient_putPreferences_error',
        err: serializeError(err),
      });
      throw err;
    }
  }

  /**
   * Get latest active appointments for an organization.
   * Calls API endpoint to fetch non-cancelled future appointments.
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
    // Assuming the schedule service has an endpoint like /get-latest-active-appointments
    // Adjust the endpoint path based on actual API structure
    const url = `${this.baseUrl}/get-latest-active-appointments`;
    const body = { organizationID: organizationId };

    try {
      const response = await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
      const data = response.data?.data ?? response.data ?? [];
      if (!Array.isArray(data)) return [];
      
      // Filter and map to expected format
      return data
        .filter((item: any) =>
          item.meta &&
          Object.keys(item.meta).length > 0 &&
          item.pk &&
          item.meta.userId &&
          item.pk.includes(item.meta.userId)
        )
        .map((item: any) => ({
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
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      const status = axiosErr?.response?.status;
      if (status === 404) return [];
      logger.error({
        event: 'scheduleServiceClient_getLatestActiveAppointments_error',
        err: serializeError(err),
        status,
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
