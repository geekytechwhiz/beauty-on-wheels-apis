import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import axiosRetry from 'axios-retry';

import type {
  ApiSuccessResponse,
  ChangeRequestDraftResponse,
  MetadataPublishResponse,
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

type RegistryEntity = 'type' | 'value';

interface ApiEnvelope<T> {
  success?: boolean;
  statusCode?: number;
  data?: T;
}

/**
 * Configures axios with auth, timeouts, and exponential retry for transient failures.
 * When `config.authToken` is set, sends `Authorization: Bearer <token>` (actor from JWT on server).
 * Request bodies must not include `createdBy`; attribution is server-side only.
 */
export function createMetadataApiClient(config: SeedRuntimeConfig): AxiosInstance {
  const bearerToken = config.authToken?.trim();
  const client = axios.create({
    baseURL: config.baseUrl.replace(/\/$/, ''),
    timeout: 30_000,
    headers: {
      'Content-Type': 'application/json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
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
    const ax = error as AxiosError<{ message?: string; error?: string; data?: { message?: string } }>;
    const body = ax.response?.data;
    if (body && typeof body === 'object') {
      if (typeof body.message === 'string') {
        return body.message;
      }
      if (typeof body.error === 'string') {
        return body.error;
      }
      if (body.data && typeof body.data === 'object' && typeof body.data.message === 'string') {
        return body.data.message;
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

function unwrapApiData<T>(body: unknown): T | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const envelope = body as ApiEnvelope<T>;
  if ('data' in envelope && envelope.data !== undefined) {
    return envelope.data;
  }
  return body as T;
}

function entityPath(config: SeedRuntimeConfig, entity: RegistryEntity): string {
  return entity === 'type' ? config.typePath : config.valuePath;
}

function buildPublishBody(
  draft: ChangeRequestDraftResponse,
  confirmationAcknowledged: boolean,
): Record<string, unknown> {
  return {
    changeRequestId: draft.changeRequestId,
    confirmationAcknowledged,
    expectedBaseVersion: draft.operation === 'Add' ? null : draft.baseVersion,
  };
}

function toApiSuccessFromDraft(draft: ChangeRequestDraftResponse): ApiSuccessResponse {
  return {
    metadataTypeCode: draft.metadataTypeCode,
    metadataValueCode: draft.metadataValueCode ?? undefined,
    valueCode: draft.metadataValueCode ?? undefined,
    changeRequestId: draft.changeRequestId,
    operation: draft.operation,
  };
}

function toApiSuccessFromPublish(publish: MetadataPublishResponse): ApiSuccessResponse {
  const published = publish.published ?? {};
  const valueCode =
    publish.metadataValueCode ??
    (typeof published.metadataValueCode === 'string' ? published.metadataValueCode : undefined) ??
    (typeof published.valueCode === 'string' ? published.valueCode : undefined);

  return {
    metadataTypeCode: publish.metadataTypeCode,
    metadataValueCode: valueCode,
    valueCode,
    version: publish.version,
    changeRequestId: publish.changeRequestId,
    operation: publish.operation,
  };
}

/**
 * Validates a minimal success response from the registry API.
 */
export function validateApiResponse(
  entity: RegistryEntity,
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

async function postRegistryAction<T>(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  entity: RegistryEntity,
  action: 'draft' | 'publish',
  body: Record<string, unknown>,
  label: string,
): Promise<{ status: number; data: T }> {
  const path = entityPath(config, entity);
  const url = `${path}?action=${action}`;

  const response = await retryRequest(
    () => client.post<ApiEnvelope<T>>(url, body),
    `${label}:${action}`,
    config.dryRun,
  );

  if (config.dryRun) {
    return { status: 200, data: response as T };
  }

  const res = response as AxiosResponse<ApiEnvelope<T>>;
  const data = unwrapApiData<T>(res.data);
  if (!data) {
    throw new Error(`Empty response data for ${label} (${action})`);
  }
  return { status: res.status, data };
}

async function draftMetadataEntity(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  entity: RegistryEntity,
  requestBody: Record<string, unknown>,
  label: string,
): Promise<RequestOutcome<ChangeRequestDraftResponse>> {
  try {
    if (config.dryRun) {
      const p = requestBody as unknown as MetadataTypeCreatePayload & MetadataValueCreatePayload;
      return {
        ok: true,
        data: {
          changeRequestId: `dry-run-${label}`,
          status: 'DRAFT',
          entityType: entity,
          operation: 'Add',
          metadataTypeCode: p.metadataTypeCode,
          metadataValueCode: p.metadataValueCode ?? null,
          baseVersion: null,
          createdAt: new Date().toISOString(),
          lastModifiedAt: new Date().toISOString(),
        },
      };
    }

    const { status, data } = await postRegistryAction<ChangeRequestDraftResponse>(
      client,
      config,
      entity,
      'draft',
      requestBody,
      label,
    );
    return { ok: true, data, statusCode: status };
  } catch (error) {
    const ax = axios.isAxiosError(error) ? error : undefined;
    return {
      ok: false,
      statusCode: ax?.response?.status,
      error: extractErrorMessage(error),
    };
  }
}

async function publishMetadataDraft(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  entity: RegistryEntity,
  draft: ChangeRequestDraftResponse,
  label: string,
): Promise<RequestOutcome<MetadataPublishResponse>> {
  try {
    if (config.dryRun) {
      return {
        ok: true,
        data: {
          changeRequestId: draft.changeRequestId,
          changeRevision: 1,
          entityType: entity,
          operation: draft.operation,
          metadataTypeCode: draft.metadataTypeCode,
          metadataValueCode: draft.metadataValueCode ?? null,
          publishStrategy: 'NEW_VERSION',
          version: draft.baseVersion === null ? 1 : (draft.baseVersion ?? 0) + 1,
        },
      };
    }

    const publishBody = buildPublishBody(draft, config.confirmationAcknowledged);
    const { status, data } = await postRegistryAction<MetadataPublishResponse>(
      client,
      config,
      entity,
      'publish',
      publishBody,
      label,
    );
    return { ok: true, data, statusCode: status };
  } catch (error) {
    const ax = axios.isAxiosError(error) ? error : undefined;
    const statusCode = ax?.response?.status;
    const message = extractErrorMessage(error);
    if (config.treatConflictAsSuccess && isConflict(statusCode, message)) {
      logger.info('Metadata publish conflict �?�?� treating as success', {
        label,
        changeRequestId: draft.changeRequestId,
      });
      return {
        ok: true,
        duplicate: true,
        statusCode,
        data: {
          changeRequestId: draft.changeRequestId,
          changeRevision: 0,
          entityType: entity,
          operation: draft.operation,
          metadataTypeCode: draft.metadataTypeCode,
          metadataValueCode: draft.metadataValueCode ?? null,
          publishStrategy: 'IN_PLACE',
          version: draft.baseVersion ?? 1,
        },
      };
    }
    return { ok: false, statusCode, error: message };
  }
}

async function createMetadataEntity(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  entity: RegistryEntity,
  requestBody: Record<string, unknown>,
  validationPayload: MetadataTypeCreatePayload | MetadataValueCreatePayload,
  label: string,
): Promise<RequestOutcome<ApiSuccessResponse>> {
  const draftOutcome = await draftMetadataEntity(client, config, entity, requestBody, label);
  if (!draftOutcome.ok || !draftOutcome.data) {
    const statusCode = draftOutcome.statusCode;
    const message = draftOutcome.error ?? 'Draft failed';
    if (config.treatConflictAsSuccess && isConflict(statusCode, message)) {
      logger.info('Metadata draft conflict �?�?� treating as success', { label });
      const p = validationPayload as MetadataTypeCreatePayload & MetadataValueCreatePayload;
      return {
        ok: true,
        duplicate: true,
        statusCode,
        data: {
          metadataTypeCode: p.metadataTypeCode,
          valueCode: p.metadataValueCode,
          metadataValueCode: p.metadataValueCode,
        },
      };
    }
    return { ok: false, statusCode, error: message };
  }

  if (!config.autoPublish) {
    const data = toApiSuccessFromDraft(draftOutcome.data);
    const validationError = validateApiResponse(entity, validationPayload, data, draftOutcome.statusCode ?? 200);
    if (validationError) {
      return { ok: false, statusCode: draftOutcome.statusCode, error: validationError };
    }
    return { ok: true, data, statusCode: draftOutcome.statusCode };
  }

  const publishOutcome = await publishMetadataDraft(client, config, entity, draftOutcome.data, label);
  if (!publishOutcome.ok || !publishOutcome.data) {
    return {
      ok: false,
      statusCode: publishOutcome.statusCode,
      error: publishOutcome.error ?? 'Publish failed',
    };
  }

  const data = toApiSuccessFromPublish(publishOutcome.data);
  const validationError = validateApiResponse(entity, validationPayload, data, publishOutcome.statusCode ?? 200);
  if (validationError) {
    return { ok: false, statusCode: publishOutcome.statusCode, error: validationError };
  }

  return {
    ok: true,
    data,
    statusCode: publishOutcome.statusCode,
    duplicate: publishOutcome.duplicate,
  };
}

/**
 * Draft (+ publish) metadata type via `POST /metadata/type?action=draft|publish`.
 * Creates when missing; updates when the type already exists (governed change request).
 */
export async function createMetadataType(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  payload: MetadataTypeCreatePayload,
): Promise<RequestOutcome<ApiSuccessResponse>> {
  const label = `type:${payload.metadataTypeCode}`;
  return createMetadataEntity(
    client,
    config,
    'type',
    payload as unknown as Record<string, unknown>,
    payload,
    label,
  );
}

/** Alias � draft (+ publish) type update uses the same governed workflow as create. */
export const updateMetadataType = createMetadataType;

export interface RegistryMetadataTypeRecord {
  metadataTypeCode: string;
  applicableModules?: string[];
  version?: number;
}

export interface RegistryMetadataValueSummary {
  valueCode?: string;
  metadataValueCode?: string;
}

export interface MetadataValuesByTypeItem {
  metadataType: string;
  values: RegistryMetadataValueSummary[];
}

export interface MetadataValuesByTypesResult {
  items: MetadataValuesByTypeItem[];
  missingMetadataTypeCodes: string[];
}

/**
 * POST `/metadata/values/by-types` � batch read published values for prerequisite hydration.
 */
export async function getMetadataValuesByTypes(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  metadataTypeCodes: string[],
): Promise<MetadataValuesByTypesResult> {
  if (!metadataTypeCodes.length) {
    return { items: [], missingMetadataTypeCodes: [] };
  }

  if (config.dryRun) {
    return { items: [], missingMetadataTypeCodes: [] };
  }

  const path = process.env.METADATA_VALUES_BY_TYPES_PATH ?? '/metadata/values/by-types';
  const response = await client.post<ApiEnvelope<MetadataValuesByTypesResult>>(path, {
    metadataTypeCodes,
  });
  const data = unwrapApiData<MetadataValuesByTypesResult>(response.data);
  if (!data) {
    return { items: [], missingMetadataTypeCodes: metadataTypeCodes };
  }
  return {
    items: data.items ?? [],
    missingMetadataTypeCodes: data.missingMetadataTypeCodes ?? [],
  };
}

/**
 * GET published metadata type (for comparing current `applicableModules` before backfill).
 */
export async function getMetadataType(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  metadataTypeCode: string,
): Promise<RegistryMetadataTypeRecord | null> {
  if (config.dryRun) {
    return { metadataTypeCode, applicableModules: [] };
  }

  const path = config.typePath.replace(/\/$/, '');
  try {
    const response = await client.get<ApiEnvelope<RegistryMetadataTypeRecord>>(path, {
      params: { metadataTypeCode },
    });
    return unwrapApiData<RegistryMetadataTypeRecord>(response.data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Draft (+ publish) metadata value via `POST /metadata/value?action=draft|publish`.
 */
export async function createMetadataValue(
  client: AxiosInstance,
  config: SeedRuntimeConfig,
  payload: MetadataValueCreatePayload,
): Promise<RequestOutcome<ApiSuccessResponse>> {
  const label = `value:${payload.metadataTypeCode}/${payload.metadataValueCode}`;

  const body: Record<string, unknown> = {
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

  return createMetadataEntity(client, config, 'value', body, payload, label);
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

/** Matches `buildRequestContext` in libs/utils � same JWT claim precedence for actor id. */
export type SeedActorClaimSource = 'custom:userID' | 'userId' | 'sub';

export interface SeedActorResolution {
  userId: string;
  claimSource: SeedActorClaimSource;
}

function stripBearerPrefix(token: string): string {
  return token.replace(/^\s*Bearer\s+/i, '').trim();
}

/** Decodes JWT payload only (no signature verification) for seed attribution logging. */
function decodeJwtPayloadForSeed(token: string): Record<string, unknown> {
  try {
    const jwt = stripBearerPrefix(token);
    const base64Url = jwt.split('.')[1];
    if (base64Url == null) {
      return {};
    }
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Resolves the actor user id the metadata registry will persist (same order as request-context.middleware).
 * Does not log or return the raw token.
 */
export function resolveSeedActorFromAuthToken(authToken: string): SeedActorResolution | undefined {
  const trimmed = authToken?.trim();
  if (!trimmed) {
    return undefined;
  }

  const decoded = decodeJwtPayloadForSeed(trimmed);
  const candidates: ReadonlyArray<[SeedActorClaimSource, unknown]> = [
    ['custom:userID', decoded['custom:userID']],
    ['userId', decoded.userId],
    ['sub', decoded.sub],
  ];

  for (const [claimSource, raw] of candidates) {
    if (typeof raw === 'string' && raw.trim() !== '') {
      return { userId: raw.trim(), claimSource };
    }
  }

  return undefined;
}

/**
 * Logs seed auth context without printing the token.
 * When AUTH_TOKEN is absent, the server stores actor `system` (GET may show "Unknown User").
 */
export function logSeedAuthContext(config: SeedRuntimeConfig): void {
  const hasAuthToken = Boolean(config.authToken?.trim());
  if (!hasAuthToken) {
    logger.info(
      'Metadata seed auth: AUTH_TOKEN not set � requests omit Authorization; server stores createdBy/lastModifiedBy as system',
    );
    return;
  }

  const actor = resolveSeedActorFromAuthToken(config.authToken);
  if (actor) {
    logger.info('Metadata seed auth: AUTH_TOKEN set � Authorization Bearer header will be sent', {
      actorUserId: actor.userId,
      actorClaimSource: actor.claimSource,
      note: 'Registry resolves display name from USER_TABLE on GET/list when this userId exists',
    });
    return;
  }

  logger.warn(
    'Metadata seed auth: AUTH_TOKEN set but no userId could be decoded (custom:userID, userId, sub) � server may still store system',
  );
}

export function loadRuntimeConfig(): SeedRuntimeConfig {
  const configured = process.env.BASE_URL?.trim();
  const baseUrl = configured || DEFAULT_LOCAL_BASE_URL;
  if (!configured) {
    logger.info('BASE_URL not set � using local default', { baseUrl: DEFAULT_LOCAL_BASE_URL });
  }

  const autoPublish = process.env.AUTO_PUBLISH !== 'false' && process.env.AUTO_PUBLISH !== '0';
  const confirmationAcknowledged =
    process.env.CONFIRMATION_ACKNOWLEDGED === 'true' ||
    process.env.CONFIRMATION_ACKNOWLEDGED === '1' ||
    process.env.CONFIRMATION_ACKNOWLEDGED === undefined;

  const authToken = stripBearerPrefix(process.env.AUTH_TOKEN?.trim() ?? '');

  return {
    baseUrl,
    authToken,
    dryRun: process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1',
    concurrency: Math.max(1, parseInt(process.env.CONCURRENCY ?? '5', 10) || 5),
    retryMax: Math.max(0, parseInt(process.env.RETRY_MAX ?? '3', 10) || 3),
    retryDelayMs: Math.max(100, parseInt(process.env.RETRY_DELAY_MS ?? '500', 10) || 500),
    typePath: process.env.METADATA_TYPE_PATH ?? '/metadata/type',
    valuePath: process.env.METADATA_VALUE_PATH ?? '/metadata/value',
    autoPublish,
    confirmationAcknowledged,
    treatConflictAsSuccess: process.env.TREAT_CONFLICT_AS_SUCCESS !== 'false',
  };
}

export type { AxiosRequestConfig };
