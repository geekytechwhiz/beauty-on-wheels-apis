import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';

import type {
  ApiSuccessResponse,
  MetadataTypeCreatePayload,
  MetadataValueCreatePayload,
  SeedRuntimeConfig,
} from './interfaces';
import { logger } from './logger';

export interface RequestOutcome<T> {
  ok: boolean;
  data?: T;
  statusCode?: number;
  error?: string;
  duplicate?: boolean;
}

/**
 * Configures axios with auth, timeouts, and exponential retry for transient failures.
 */
export function createMetadataApiClient(config: SeedRuntimeConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.baseUrl.replace(/\/$/, ''),
    timeout: 30_000,
    headers: {
      'Content-Type': 'application/json',
      ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
    },
  });

  axiosRetry(client, {
    retries: config.retryMax,
    retryDelay: (retryCount) => config.retryDelayMs * retryCount,
    retryCondition: (error) => {
      const status = error.response?.status;
      if (!status) {
        return true;
      }
      return status >= 500 || status === 429;
    },
    onRetry: (retryCount, error) => {
      logger.warn('Retrying metadata API request', {
        attempt: retryCount,
        url: error.config?.url,
        status: error.response?.status,
      });
    },
  });

  return client;
}

/**
 * Executes a request with optional dry-run (no HTTP).
 */
export async function retryRequest<T>(
  fn: () => Promise<T>,
  label: string,
  dryRun: boolean,
): Promise<T> {
  if (dryRun) {
    logger.info('[dry-run] Skipping HTTP call', { label });
    return { dryRun: true, label } as T;
  }
  return fn();
}

function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<{ message?: string; error?: string }>;
    const body = ax.response?.data;
    if (body && typeof body === 'object') {
      if (typeof body.message === 'string') {
        return body.message;
      }
      if (typeof body.error === 'string') {
        return body.error;
      }
    }
    return ax.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isConflict(status?: number, message?: string): boolean {
  if (status === 409) {
    return true;
  }
  return Boolean(message?.toLowerCase().includes('already exists'));
}

/**
 * Validates a minimal success response from the registry API.
 */
export function validateApiResponse(
  entity: 'type' | 'value',
  payload: MetadataTypeCreatePayload | MetadataValueCreatePayload,
  data: unknown,
  statusCode: number,
): string | null {
  if (statusCode < 200 || statusCode >= 300) {
    return `Unexpected status ${statusCode}`;
  }
  if (!data || typeof data !== 'object') {
    return 'Empty or non-object response body';
  }
  const body = data as ApiSuccessResponse;
  if (entity === 'type') {
    const p = payload as MetadataTypeCreatePayload;
    if (body.metadataTypeCode && body.metadataTypeCode !== p.metadataTypeCode) {
      return `Response metadataTypeCode mismatch: ${body.metadataTypeCode}`;
    }
  } else {
    const p = payload as MetadataValueCreatePayload;
    const code = body.valueCode ?? body.metadataValueCode;
    if (code && code !== p.metadataValueCode) {
      return `Response value code mismatch: ${code}`;
    }
  }
  return null;
}

/**
 * POST metadata type (immutable create / upsert).
 * Default path: `/metadata/type` (override via `METADATA_TYPE_PATH`).
 */
export async function createMetadataType(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  payload: MetadataTypeCreatePayload,
): Promise<RequestOutcome<ApiSuccessResponse>> {
  const label = `type:${payload.metadataTypeCode}`;

  try {
    const data = await retryRequest(async () => {
      const res = await client.post<ApiSuccessResponse>(config.typePath, payload);
      return res;
    }, label, config.dryRun);

    if (config.dryRun) {
      return { ok: true, data: { metadataTypeCode: payload.metadataTypeCode, version: 1 } };
    }

    const res = data as { status: number; data: ApiSuccessResponse };
    const validationError = validateApiResponse('type', payload, res.data, res.status);
    if (validationError) {
      return { ok: false, statusCode: res.status, error: validationError };
    }
    return { ok: true, data: res.data, statusCode: res.status };
  } catch (error) {
    const ax = axios.isAxiosError(error) ? error : undefined;
    const statusCode = ax?.response?.status;
    const message = extractErrorMessage(error);
    if (config.treatConflictAsSuccess && isConflict(statusCode, message)) {
      logger.info('Metadata type already exists — treating as success', {
        metadataTypeCode: payload.metadataTypeCode,
      });
      return { ok: true, duplicate: true, statusCode, data: { metadataTypeCode: payload.metadataTypeCode } };
    }
    return { ok: false, statusCode, error: message };
  }
}

/**
 * POST metadata value (immutable create / upsert).
 * Default path: `/metadata/value` (override via `METADATA_VALUE_PATH`).
 */
export async function createMetadataValue(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  payload: MetadataValueCreatePayload,
): Promise<RequestOutcome<ApiSuccessResponse>> {
  const label = `value:${payload.metadataTypeCode}/${payload.metadataValueCode}`;

  const body = {
    metadataTypeCode: payload.metadataTypeCode,
    metadataValueCode: payload.metadataValueCode,
    valueCode: payload.metadataValueCode,
    label: payload.label,
    status: payload.status,
    isGlobal: payload.isGlobal,
    ...(payload.description ? { description: payload.description } : {}),
    ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
    ...(payload.applicableModules ? { applicableModules: payload.applicableModules } : {}),
    ...(payload.applicableCategories ? { applicableCategories: payload.applicableCategories } : {}),
    ...(payload.applicableConditions ? { applicableConditions: payload.applicableConditions } : {}),
    ...(payload.applicableCountries ? { applicableCountries: payload.applicableCountries } : {}),
    ...(payload.applicableLanguages ? { applicableLanguages: payload.applicableLanguages } : {}),
    ...(payload.valueAttributes ? { valueAttributes: payload.valueAttributes } : {}),
    ...(payload.relationships?.length ? { relationships: payload.relationships } : {}),
  };

  try {
    const data = await retryRequest(async () => {
      const res = await client.post<ApiSuccessResponse>(config.valuePath, body);
      return res;
    }, label, config.dryRun);

    if (config.dryRun) {
      return {
        ok: true,
        data: {
          metadataTypeCode: payload.metadataTypeCode,
          valueCode: payload.metadataValueCode,
          version: 1,
        },
      };
    }

    const res = data as { status: number; data: ApiSuccessResponse };
    const validationError = validateApiResponse('value', payload, res.data, res.status);
    if (validationError) {
      return { ok: false, statusCode: res.status, error: validationError };
    }
    return { ok: true, data: res.data, statusCode: res.status };
  } catch (error) {
    const ax = axios.isAxiosError(error) ? error : undefined;
    const statusCode = ax?.response?.status;
    const message = extractErrorMessage(error);
    if (config.treatConflictAsSuccess && isConflict(statusCode, message)) {
      logger.info('Metadata value already exists — treating as success', {
        metadataTypeCode: payload.metadataTypeCode,
        metadataValueCode: payload.metadataValueCode,
      });
      return {
        ok: true,
        duplicate: true,
        statusCode,
        data: {
          metadataTypeCode: payload.metadataTypeCode,
          valueCode: payload.metadataValueCode,
        },
      };
    }
    return { ok: false, statusCode, error: message };
  }
}

/**
 * Runs async tasks with a concurrency limit (pool).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) {
        return;
      }
      try {
        const value = await worker(items[i], i);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));
  return results;
}

/** serverless-offline exposes routes as `http://localhost:3000/{stage}/...` */
const DEFAULT_LOCAL_BASE_URL = 'http://localhost:3000/dev';

export function loadRuntimeConfig(): SeedRuntimeConfig {
  const configured = process.env.BASE_URL?.trim();
  const baseUrl = configured || DEFAULT_LOCAL_BASE_URL;
  if (!configured) {
    logger.info('BASE_URL not set — using local default', { baseUrl: DEFAULT_LOCAL_BASE_URL });
  }

  return {
    baseUrl,
    authToken: process.env.AUTH_TOKEN?.trim() ?? '',
    dryRun: process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1',
    concurrency: Math.max(1, parseInt(process.env.CONCURRENCY ?? '5', 10) || 5),
    retryMax: Math.max(0, parseInt(process.env.RETRY_MAX ?? '3', 10) || 3),
    retryDelayMs: Math.max(100, parseInt(process.env.RETRY_DELAY_MS ?? '500', 10) || 500),
    typePath: process.env.METADATA_TYPE_PATH ?? '/metadata/type',
    valuePath: process.env.METADATA_VALUE_PATH ?? '/metadata/value',
    treatConflictAsSuccess: process.env.TREAT_CONFLICT_AS_SUCCESS !== 'false',
  };
}

export type { AxiosRequestConfig };
