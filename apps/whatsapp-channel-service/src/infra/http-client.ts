import { getContext, recordUpstreamRetryAttempts } from '@api-hub/observability';
import { ChannelError, CHANNEL_ERROR_CODE, fromHttpStatus } from '../errors/channel-error';

export interface ServiceHttpOptions {
  baseUrl: string;
  dependency: string;
  token?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const RETRYABLE = new Set<string>([CHANNEL_ERROR_CODE.TIMEOUT, CHANNEL_ERROR_CODE.UNAVAILABLE]);

export function unwrapData(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const record = body as Record<string, unknown>;
  if ('success' in record && 'data' in record) {
    if (record.success === false) {
      const error = record.error as { code?: string } | null;
      throw new ChannelError(CHANNEL_ERROR_CODE.INTERNAL_ERROR, 'Downstream response was not successful', {
        metadata: { downstreamCode: error?.code },
      });
    }
    return record.data;
  }
  return body;
}

export function asItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const record = data as { items?: unknown; data?: unknown };
    if (Array.isArray(record.items)) return record.items as T[];
    if (Array.isArray(record.data)) return record.data as T[];
  }
  throw new ChannelError(CHANNEL_ERROR_CODE.INTERNAL_ERROR, 'Malformed downstream list response');
}

export function nextTokenOf(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const token = (data as { nextToken?: unknown; pagination?: { nextCursor?: unknown } }).nextToken;
  if (typeof token === 'string' && token.length > 0) return token;
  const cursor = (data as { pagination?: { nextCursor?: unknown } }).pagination?.nextCursor;
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ServiceHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ServiceHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined, true);
  }

  post<T>(path: string, body: unknown, retry = false): Promise<T> {
    return this.request<T>('POST', path, body, retry);
  }

  put<T>(path: string, body: unknown, retry = true): Promise<T> {
    return this.request<T>('PUT', path, body, retry);
  }

  private async request<T>(method: string, path: string, body: unknown, retry: boolean): Promise<T> {
    if (!this.options.baseUrl) {
      throw new ChannelError(CHANNEL_ERROR_CODE.UNAVAILABLE, `${this.options.dependency} base URL is not configured`, {
        retryable: false,
        metadata: { dependency: this.options.dependency, gap: 'MISSING_CONTRACT' },
      });
    }

    const attempts = retry ? 3 : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.once<T>(method, path, body);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ChannelError && RETRYABLE.has(error.code);
        if (!retry || !retryable || attempt === attempts) throw error;
        recordUpstreamRetryAttempts(this.options.dependency, 1);
        await sleep(100 * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  private async once<T>(method: string, path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': getContext().correlationId || 'unknown',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;

    const url = `${this.options.baseUrl.replace(/\/$/, '')}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ChannelError(CHANNEL_ERROR_CODE.TIMEOUT, `${this.options.dependency} timed out`, {
          retryable: true,
          metadata: { dependency: this.options.dependency },
        });
      }
      throw new ChannelError(CHANNEL_ERROR_CODE.UNAVAILABLE, `${this.options.dependency} request failed`, {
        retryable: true,
        metadata: { dependency: this.options.dependency },
      });
    }

    const raw = await response.text();
    if (!response.ok) {
      throw fromHttpStatus(response.status, this.options.dependency, raw.slice(0, 300));
    }
    if (!raw) return undefined as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new ChannelError(CHANNEL_ERROR_CODE.INTERNAL_ERROR, `${this.options.dependency} returned malformed JSON`, {
        metadata: { dependency: this.options.dependency },
      });
    }
  }
}
