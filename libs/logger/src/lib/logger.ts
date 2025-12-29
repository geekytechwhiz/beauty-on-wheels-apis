import winston, { Logger, LoggerOptions, format } from 'winston';
import { randomUUID } from 'crypto'; 

const CORRELATION_HEADER = 'X-Correlation-ID';
const DEFAULT_LOG_LEVEL = 'info';

export interface CorrelationContext {
  correlationId: string;
}

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  base?: Record<string, unknown>;
  winstonOptions?: LoggerOptions;
  redactPII?: boolean;
  prettyPrint?: boolean;
  enableSampling?: boolean;
  sampleRate?: number;
}

export interface LogFnArgs {
  msg: string;
  data?: Record<string, unknown>;
  err?: Error;
}

export interface ApiGatewayEventLike {
  headers?: Record<string, string | undefined>;
  requestContext?: {
    requestId?: string;
    http?: {
      method?: string;
      path?: string;
    };
  };
}

export interface LambdaContextLike {
  awsRequestId?: string;
  functionName?: string;
  functionVersion?: string;
  invokedFunctionArn?: string;
  memoryLimitInMB?: string;
}

export interface PerformanceLog {
  operation: string;
  duration: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

const PII_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'apikey',
  'authorization',
  'auth',
  'creditCard',
  'creditcard',
  'ssn',
  'socialSecurityNumber',
  'email',
  'phone',
  'phoneNumber',
  'address',
  'zipCode',
  'zipcode',
  'dateOfBirth',
  'dateofbirth',
  'dob',
];

function shouldRedact(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return PII_FIELDS.some((field) => lowerKey.includes(field));
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length > 0 && value.length <= 20) {
      return '***REDACTED***';
    }
    return `${value.substring(0, 4)}***REDACTED***`;
  }
  return '***REDACTED***';
}

function redactPII(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (shouldRedact(key)) {
      redacted[key] = redactValue(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error)) {
      redacted[key] = redactPII(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function extractCorrelationId(event?: ApiGatewayEventLike): string {
  const existing =
    event?.headers?.[CORRELATION_HEADER] ||
    event?.headers?.[CORRELATION_HEADER.toLowerCase()] ||
    event?.requestContext?.requestId;
  return existing || randomUUID();
}

export function extractAwsRequestId(context?: LambdaContextLike): string | undefined {
  return context?.awsRequestId;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const level = opts.level || process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL;
  const isLocal = process.env.IS_OFFLINE === 'true' || process.env.NODE_ENV === 'local' || !process.env.NODE_ENV;
  const shouldPrettyPrint = opts.prettyPrint !== undefined ? opts.prettyPrint : isLocal;

  const baseContext: Record<string, unknown> = {
    service: opts.service,
    environment: process.env.STAGE || process.env.NODE_ENV || 'local',
    ...opts.base,
  };

  const formats = [
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    format((info: winston.Logform.TransformableInfo) => {
      // Merge base context into log info
      return { ...baseContext, ...info };
    })(),
  ];

  if (shouldPrettyPrint) {
    formats.push(
      format.colorize(),
      format.printf((info: winston.Logform.TransformableInfo) => {
        const { timestamp, level, message, ...meta } = info;
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level}]: ${message} ${metaStr}`;
      })
    );
  } else {
    formats.push(format.json());
  }

  const winstonConfig: LoggerOptions = {
    level,
    format: format.combine(...formats),
    defaultMeta: baseContext,
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error'],
      }),
    ],
    ...opts.winstonOptions,
  };

  const logger = winston.createLogger(winstonConfig);

  if (opts.redactPII !== false) {
    const originalChild = logger.child.bind(logger);
    logger.child = function (bindings: Record<string, unknown>) {
      const redactedBindings = redactPII(bindings);
      return originalChild(redactedBindings);
    };
  }

  return logger;
}

export function createChildLogger(
  parentLogger: Logger,
  bindings: Record<string, unknown>,
  shouldRedactPII = true,
): Logger {
  const processedBindings = shouldRedactPII ? redactPII(bindings) : bindings;
  return parentLogger.child(processedBindings);
}

export function withCorrelation<T extends (...args: unknown[]) => unknown>(
  handler: T,
  service: string,
  logger?: Logger,
  context?: LambdaContextLike,
): (...handlerArgs: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const event = args[0] as ApiGatewayEventLike | undefined;
    const correlationId = extractCorrelationId(event);
    const awsRequestId = extractAwsRequestId(context);
    const log =
      logger ||
      createLogger({
        service,
        base: { correlationId, ...(awsRequestId && { awsRequestId }) },
      });

    const startTime = Date.now();
    try {
      log.debug('Incoming event', {
        correlationId,
        awsRequestId,
        eventSummary: summarizeEvent(event),
      });
      const result = await Promise.resolve(handler(...args));
      const duration = Date.now() - startTime;
      log.debug('Handler success', {
        correlationId,
        awsRequestId,
        duration,
      });
      return result as Awaited<ReturnType<T>>;
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      const errorDetails = serializeError(err);
      log.error('Handler error', {
        err: errorDetails,
        correlationId,
        awsRequestId,
        duration,
      });
      throw err;
    }
  };
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err as { code?: string; statusCode?: number; cause?: unknown }),
    };
  }
  return { error: String(err) };
}

function summarizeEvent(e?: ApiGatewayEventLike): Record<string, unknown> {
  if (!e) return {};
  return {
    hasHeaders: !!e.headers,
    method: e.requestContext?.http?.method,
    path: e.requestContext?.http?.path,
    requestId: e.requestContext?.requestId,
  };
}

export function logPerformance(
  logger: Logger,
  operation: string,
  startTime: number,
  metadata?: Record<string, unknown>,
  correlationId?: string,
): void {
  const duration = Date.now() - startTime;
  logger.info(`Performance: ${operation} took ${duration}ms`, {
    event: 'performance',
    operation,
    duration,
    correlationId,
    ...metadata,
  });
}

export function createPerformanceTimer(logger: Logger, operation: string, correlationId?: string) {
  const startTime = Date.now();
  return {
    end: (metadata?: Record<string, unknown>) => {
      logPerformance(logger, operation, startTime, metadata, correlationId);
    },
    getDuration: () => Date.now() - startTime,
  };
}

export function logHttpRequest(
  logger: Logger,
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  correlationId?: string,
  metadata?: Record<string, unknown>,
): void {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  logger[level](`${method} ${path} ${statusCode} ${duration}ms`, {
    event: 'http_request',
    method,
    path,
    statusCode,
    duration,
    correlationId,
    ...metadata,
  });
}

export function shouldSample(_logger: Logger, sampleRate = 1.0): boolean {
  if (sampleRate >= 1.0) return true;
  return Math.random() < sampleRate;
}

export function createMockLogger(): Logger {
  const mockLogger = {
    debug: () => mockLogger,
    info: () => mockLogger,
    warn: () => mockLogger,
    error: () => mockLogger,
    fatal: () => mockLogger,
    trace: () => mockLogger,
    silent: () => mockLogger,
    child: () => mockLogger,
    level: 'info',
    levels: winston.config.npm.levels,
    format: winston.format.json(),
    transports: [],
    log: () => mockLogger,
    startTimer: () => ({ done: () => {} }),
    configure: () => mockLogger,
    add: () => mockLogger,
    remove: () => mockLogger,
    clear: () => mockLogger,
    close: () => mockLogger,
    query: () => ({}),
    stream: () => ({} as NodeJS.ReadableStream),
    getMaxListeners: () => 10,
    setMaxListeners: () => mockLogger,
    emit: () => true,
    on: () => mockLogger,
    once: () => mockLogger,
    off: () => mockLogger,
    removeListener: () => mockLogger,
    removeAllListeners: () => mockLogger,
    listeners: () => [],
    rawListeners: () => [],
    listenerCount: () => 0,
    prependListener: () => mockLogger,
    prependOnceListener: () => mockLogger,
    eventNames: () => [],
  } as unknown as Logger;
  return mockLogger;
}

export const correlationMiddleware = { withCorrelation, extractCorrelationId, extractAwsRequestId };
