import type { Context as LambdaContext } from 'aws-lambda';

type LoggerLike = {
  info: (entry: Record<string, unknown>) => void;
  warn: (entry: Record<string, unknown>) => void;
  error: (entry: Record<string, unknown>) => void;
};

const REDACTED_KEYS = new Set([
  'password',
  'email',
  'phone',
  'token',
  'authorization',
]);

const toLowerKey = (value: string): string => value.toLowerCase();

const safeStringify = (value: unknown): string => {
  const visited = new WeakSet<object>();
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === 'object' && current !== null) {
      if (visited.has(current)) {
        return '[Circular]';
      }
      visited.add(current);
    }
    return current;
  });
};

const safeParse = (value: unknown): unknown => {
  const serialized = safeStringify(value);
  return JSON.parse(serialized) as unknown;
};

export const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    const source = error as Error & { code?: string; cause?: unknown };
    return {
      name: source.name,
      message: source.message,
      stack: source.stack,
      ...(source.code ? { code: source.code } : {}),
      ...(source.cause ? { cause: safeParse(source.cause) } : {}),
    };
  }

  if (typeof error === 'object' && error !== null) {
    return {
      name: 'NonErrorThrowable',
      message: 'Non-Error value thrown',
      value: safeParse(error),
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
};

export const redactPII = (data: unknown): unknown => {
  if (Array.isArray(data)) {
    return data.map((item) => redactPII(item));
  }

  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_KEYS.has(toLowerKey(key))) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = redactPII(value);
  }

  return output;
};

export const extractCorrelationId = (event: {
  headers?: Record<string, unknown>;
  requestContext?: { requestId?: string };
}): string => {
  const headers = event.headers ?? {};
  const correlationId =
    headers['x-correlation-id'] ??
    headers['X-Correlation-Id'] ??
    headers['correlation-id'] ??
    headers['Correlation-Id'];

  if (typeof correlationId === 'string' && correlationId.length > 0) {
    return correlationId;
  }

  if (typeof event.requestContext?.requestId === 'string') {
    return event.requestContext.requestId;
  }

  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const extractAwsRequestId = (context: LambdaContext): string =>
  context.awsRequestId || 'unknown-request-id';

export interface HttpLogData {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  correlationId?: string;
  awsRequestId?: string;
  event?: string;
  [key: string]: unknown;
}

export const logHttpRequest = (logger: LoggerLike, data: HttpLogData): void => {
  const payload: Record<string, unknown> = {
    event: data.event ?? 'http_request',
    message: 'HTTP request completed',
    correlationId: data.correlationId,
    awsRequestId: data.awsRequestId,
    duration: data.duration,
    http: {
      method: data.method,
      path: data.path,
      statusCode: data.statusCode,
    },
  };

  if (data.statusCode >= 500) {
    logger.error(payload);
    return;
  }

  if (data.statusCode >= 400) {
    logger.warn(payload);
    return;
  }

  logger.info(payload);
};

export interface PerformanceTimer {
  end: () => void;
}

export const createPerformanceTimer = (
  logger: LoggerLike,
  operation: string
): PerformanceTimer => {
  const start = Date.now();
  return {
    end: (): void => {
      logger.info({
        event: 'performance_timer',
        message: 'Performance timer completed',
        operation,
        duration: Date.now() - start,
      });
    },
  };
};

