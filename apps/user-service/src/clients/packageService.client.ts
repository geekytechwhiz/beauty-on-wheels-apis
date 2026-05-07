import axios from 'axios';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

export interface PackageServiceClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export interface UserServiceRequest {
  userId: string;
  userPackageId?: string;
  userAddonId?: string;
}

export interface ScheduledService {
  scheduleId?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UserServiceResponse {
  userId: string;
  userPackageId?: string;
  userAddonId?: string;
  scheduled?: ScheduledService[];
  [key: string]: unknown;
}

/**
 * Client for Package service to fetch user services.
 * Used to get active services (packages/addons) for users with appointments.
 */
export class PackageServiceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: PackageServiceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Get user services by list of user/service identifiers.
   * Calls API endpoint with array of { userId, userPackageId?, userAddonId? }.
   */
  async getServicesByList(
    requests: UserServiceRequest[],
    authHeader?: string,
  ): Promise<UserServiceResponse[]> {
    const logger = createChildLogger(baseLogger, { requestCount: requests.length });
    const url = `${this.baseUrl}/services/get-services-by-list`;

    try {
      const response = await axios.post(url, requests, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: this.timeoutMs,
      });
      // console.log('response.data', JSON.stringify(response.data));

      const data = response.data?.data?.items ?? response.data?.items ?? [];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      logger.error({
        event: 'packageServiceClient_getServicesByList_error',
        err: serializeError(err),
      });
      throw err;
    }
  }
}

const defaultBaseUrl = process.env.PACKAGE_API_URL ?? '';
const defaultTimeoutMs = Number(process.env.SCHEDULE_SERVICE_API_TIMEOUT_MS) || 10_000;

/** Singleton instance using env PACKAGE_API_URL. */
export const packageServiceClient = defaultBaseUrl
  ? new PackageServiceClient({ baseUrl: defaultBaseUrl, timeoutMs: defaultTimeoutMs })
  : null;
