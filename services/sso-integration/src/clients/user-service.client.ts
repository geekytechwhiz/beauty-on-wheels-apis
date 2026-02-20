/**
 * User Service API Client — internal endpoints for SSO orchestration
 *
 * SSO does NOT create users; it calls user-service to ensure the user exists
 * (GET by-external-id, or POST create) before performing Cognito auth.
 */

import { getConfig } from '../config';
import { logger } from '../utils/logger';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface GetByExternalIdParams {
  provider: string;
  external_id: string;
  tenant_id: string;
}

export interface UserServiceUser {
  userID: string;
  organizationID?: string;
  external_id?: string;
  provider?: string;
  tenant_id?: string;
  role?: string;
  [key: string]: unknown;
}

export interface CreateSsoUserPayload {
  external_id: string;
  provider: string;
  tenant_id: string;
  role: string;
  source: string;
}

export class UserServiceClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, apiKey?: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const config = getConfig();
    this.baseUrl = (baseUrl ?? config.userServiceBaseUrl).replace(/\/$/, '');
    this.apiKey = apiKey ?? config.userServiceInternalApiKey;
    this.timeoutMs = timeoutMs;
  }

  /** Returns true if user-service is configured (base URL set). */
  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object
  ): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['X-Internal-Api-Key'] = this.apiKey;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      let data: T;
      const text = await res.text();
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        data = text as unknown as T;
      }
      return { status: res.status, data };
    } catch (err) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('User-service request failed', { method, path, error: message });
      throw err;
    }
  }

  /**
   * GET /internal/users/by-external-id?provider=...&external_id=...&tenant_id=...
   * Returns user if found, null if 404.
   */
  async getByExternalId(params: GetByExternalIdParams): Promise<UserServiceUser | null> {
    const q = new URLSearchParams({
      provider: params.provider,
      external_id: params.external_id,
      tenant_id: params.tenant_id,
    });
    const path = `/internal/users/by-external-id?${q.toString()}`;
    const { status, data } = await this.request<UserServiceUser | { user?: UserServiceUser }>(
      'GET',
      path
    );
    if (status === 404) return null;
    if (status !== 200) {
      logger.warn('User-service getByExternalId unexpected status', { status, path });
      throw new Error(`User-service returned ${status}`);
    }
    const user = (data as any).user ?? data;
    if (user && typeof user === 'object' && (user.userID || user.userId)) {
      return {
        ...user,
        userID: user.userID ?? user.userId,
      } as UserServiceUser;
    }
    return null;
  }

  /**
   * POST /internal/users — create SSO user (idempotent by provider+external_id+tenant_id).
   * user-service creates UserTable record and Cognito user.
   */
  async createSsoUser(payload: CreateSsoUserPayload): Promise<UserServiceUser> {
    const path = '/internal/users';
    const { status, data } = await this.request<UserServiceUser | { user?: UserServiceUser }>(
      'POST',
      path,
      payload
    );
    if (status !== 201 && status !== 200) {
      logger.warn('User-service createSsoUser failed', { status, payload });
      throw new Error(`User-service create returned ${status}`);
    }
    const user = (data as any).user ?? data;
    if (user && typeof user === 'object' && (user.userID || user.userId)) {
      return {
        ...user,
        userID: user.userID ?? user.userId,
      } as UserServiceUser;
    }
    throw new Error('User-service create did not return user');
  }
}
