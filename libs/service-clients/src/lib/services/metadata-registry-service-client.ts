import type { ApiResponseBody } from '@api-hub/utils';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

import { createHttpClient } from '../client/axios-client';
import type {
  MetadataValuesByTypesRequestDto,
  MetadataValuesByTypesResultDto,
} from '../types/metadata.dto';

const VALUES_BY_TYPES_PATH = '/metadata/values/by-types';

export class MetadataRegistryClientError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 502, code = 'UPSTREAM_ERROR') {
    super(message);
    this.name = 'MetadataRegistryClientError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function resolveBaseUrl(baseUrl?: string): string {
  const configured = (baseUrl ?? process.env.METADATA_REGISTRY_SERVICE_BASE_URL ?? '').trim();
  if (!configured) {
    throw new MetadataRegistryClientError(
      'METADATA_REGISTRY_SERVICE_BASE_URL is not configured',
      500,
      'CONFIGURATION_ERROR',
    );
  }
  return configured.replace(/\/$/, '');
}

function resolveTimeoutMs(): number {
  const raw = process.env.METADATA_REGISTRY_SERVICE_TIMEOUT_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 15_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
}

function normalizeAuthHeader(authHeader?: string): string | undefined {
  const trimmed = authHeader?.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase().startsWith('bearer ') ? trimmed : `Bearer ${trimmed}`;
}

function unwrapEnvelope<T>(body: unknown, httpStatus: number): T {
  if (!body || typeof body !== 'object') {
    throw new MetadataRegistryClientError('Metadata registry returned an empty response', httpStatus);
  }

  const envelope = body as ApiResponseBody<T>;
  if (envelope.success === false || envelope.data == null) {
    const description =
      typeof envelope.message === 'object' && envelope.message?.description
        ? envelope.message.description
        : 'Metadata registry request failed';
    throw new MetadataRegistryClientError(description, envelope.statusCode ?? httpStatus);
  }

  return envelope.data;
}

/**
 * HTTP client for metadata-registry-service consumer APIs.
 * Forwards the caller's Authorization header and unwraps the standard ApiResponse envelope.
 */
export class MetadataRegistryServiceClient {
  private readonly client: AxiosInstance;
  private readonly serviceName = 'metadata-registry-service';

  constructor(baseUrl?: string) {
    this.client = createHttpClient(resolveBaseUrl(baseUrl));
    this.client.defaults.timeout = resolveTimeoutMs();
  }

  async getValuesByTypes(
    metadataTypeCodes: string[],
    authHeader?: string,
  ): Promise<MetadataValuesByTypesResultDto> {
    const authorization = normalizeAuthHeader(authHeader);
    if (!authorization) {
      throw new MetadataRegistryClientError('Authorization header is required', 401, 'UNAUTHORIZED');
    }

    const payload: MetadataValuesByTypesRequestDto = { metadataTypeCodes };

    try {
      const response = await this.client.post<ApiResponseBody<MetadataValuesByTypesResultDto>>(
        VALUES_BY_TYPES_PATH,
        payload,
        {
          headers: {
            Authorization: authorization,
            'X-Service-Name': this.serviceName,
          },
        },
      );

      return unwrapEnvelope<MetadataValuesByTypesResultDto>(response.data, response.status);
    } catch (error) {
      if (error instanceof MetadataRegistryClientError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 502;
        const body = error.response?.data;
        if (body && typeof body === 'object') {
          try {
            return unwrapEnvelope<MetadataValuesByTypesResultDto>(body, status);
          } catch (unwrapError) {
            if (unwrapError instanceof MetadataRegistryClientError) {
              throw unwrapError;
            }
          }
        }

        throw new MetadataRegistryClientError(
          error.message || 'Metadata registry request failed',
          status,
        );
      }

      throw new MetadataRegistryClientError(
        error instanceof Error ? error.message : 'Metadata registry request failed',
      );
    }
  }
}

let metadataRegistryServiceClient: MetadataRegistryServiceClient | undefined;

export function getMetadataRegistryServiceClient(): MetadataRegistryServiceClient {
  if (!metadataRegistryServiceClient) {
    metadataRegistryServiceClient = new MetadataRegistryServiceClient();
  }
  return metadataRegistryServiceClient;
}
