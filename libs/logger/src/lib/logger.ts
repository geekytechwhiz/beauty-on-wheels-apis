import winston from 'winston';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { Context } from 'aws-lambda';

// Increase max listeners to prevent warnings when multiple logger instances are created
// This is common in Lambda environments where modules are imported multiple times
if (typeof process.getMaxListeners === 'function') {
  const currentMax = process.getMaxListeners();
  if (currentMax < 20) {
    process.setMaxListeners(20);
  }
}

/**
 * Logger options interface
 */
export interface LoggerOptions {
  service?: string;
  redactPII?: boolean;
  [key: string]: unknown;
}

/**
 * Logger context interface for structured logging
 */
export interface LoggerContext {
  correlationId?: string;
  awsRequestId?: string;
  userId?: string;
  organizationId?: string;
  requestId?: string;
  functionName?: string;
  [key: string]: unknown;
}

/**
 * Log entry interface
 */
export interface LogEntry {
  event?: string;
  message?: string;
  err?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  [key: string]: unknown;
}

/**
 * Performance timer interface
 */
export interface PerformanceTimer {
  end: () => void;
}

/**
 * Custom format for error objects
 */
const errorFormat = winston.format((info) => {
  if (info instanceof Error) {
    return {
      ...info,
      message: info.message,
      stack: info.stack,
      name: info.name,
    };
  }

  if (info.err instanceof Error) {
    info.error = {
      name: info.err.name,
      message: info.err.message,
      stack: info.err.stack,
      code: (info.err as { code?: string }).code,
    };
    delete info.err;
  }

  if (info.error instanceof Error) {
    info.error = {
      name: info.error.name,
      message: info.error.message,
      stack: info.error.stack,
      code: (info.error as { code?: string }).code,
    };
  }

  return info;
});

/**
 * JSON format for production (CloudWatch/Log aggregation)
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errorFormat(),
  winston.format.json()
);

/**
 * Determine log level based on environment
 */
const getLogLevel = (): string => {
  const env = process.env.NODE_ENV || 'development';
  const logLevel = process.env.LOG_LEVEL?.toLowerCase();

  const validLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
  if (logLevel && validLevels.includes(logLevel)) {
    return logLevel;
  }

  return env === 'production' ? 'info' : 'debug';
};

/**
 * Create Winston logger instance
 */
const createWinstonLogger = (options?: LoggerOptions): winston.Logger => {
  const env = process.env.NODE_ENV || 'development';
  const isTest = env === 'test';
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  const defaultMeta = {
    service: options?.service || 'unknown-service',
    ...(options && { ...options }),
  };

  const transports: winston.transport[] = [
    // Console transport (always enabled)
    new winston.transports.Console({
      level: getLogLevel(),
      format: jsonFormat, // Always use JSON format
      silent: isTest, // Silence logs in test environment
    }),
  ];

  const loggerConfig: winston.LoggerOptions = {
    level: getLogLevel(),
    defaultMeta,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true })
    ),
    transports,
    // Don't exit on handled exceptions
    exitOnError: false,
  };

  if (!isLambda) {
    loggerConfig.exceptionHandlers = [
      new winston.transports.Console({
        format: jsonFormat, // Always use JSON format
      }),
    ];
    loggerConfig.rejectionHandlers = [
      new winston.transports.Console({
        format: jsonFormat, // Always use JSON format
      }),
    ];
  }

  return winston.createLogger(loggerConfig);
};

/**
 * Logger class with convenient methods
 */
export class Logger {
  private logger: winston.Logger;
  private context?: LoggerContext;

  constructor(winstonLogger: winston.Logger, context?: LoggerContext) {
    this.logger = winstonLogger;
    this.context = context;
  }

  /**
   * Log error level
   */
  error(entry: LogEntry): void {
    this.logger.error({
      ...this.context,
      ...entry,
    });
  }

  /**
   * Log warn level
   */
  warn(entry: LogEntry): void {
    this.logger.warn({
      ...this.context,
      ...entry,
    });
  }

  /**
   * Log info level
   */
  info(entry: LogEntry): void {
    this.logger.info({
      ...this.context,
      ...entry,
    });
  }

  /**
   * Log HTTP level
   */
  http(entry: LogEntry): void {
    this.logger.http({
      ...this.context,
      ...entry,
    });
  }

  /**
   * Log verbose level
   */
  verbose(entry: LogEntry): void {
    this.logger.verbose({
      ...this.context,
      ...entry,
    });
  }

  /**
   * Log debug level
   */
  debug(entry: LogEntry): void {
    this.logger.debug({
      ...this.context,
      ...entry,
    });
  }
}

/**
 * Create a logger instance
 */
export const createLogger = (options?: LoggerOptions): Logger => {
  const winstonLogger = createWinstonLogger(options);
  return new Logger(winstonLogger);
};

/**
 * Create a child logger with additional context
 */
export const createChildLogger = (
  baseLogger: Logger,
  context: LoggerContext
): Logger => {
  // Access the underlying winston logger
  const winstonLogger = (baseLogger as unknown as { logger: winston.Logger })
    .logger;
  const mergedContext = {
    ...(baseLogger as unknown as { context?: LoggerContext }).context,
    ...context,
  };
  return new Logger(winstonLogger, mergedContext);
};

/**
 * Extract correlation ID from API Gateway event
 */
export const extractCorrelationId = (
  event: APIGatewayProxyEvent | { headers?: Record<string, unknown> }
): string => {
  // Try to get from headers
  if (event.headers) {
    const correlationId =
      event.headers['x-correlation-id'] ||
      event.headers['X-Correlation-Id'] ||
      event.headers['correlation-id'] ||
      event.headers['Correlation-Id'];

    if (correlationId && typeof correlationId === 'string') {
      return correlationId;
    }
  }

  // Try to get from request context
  if ('requestContext' in event && event.requestContext) {
    const requestId = (event.requestContext as { requestId?: string })
      .requestId;
    if (requestId) {
      return requestId;
    }
  }

  // Generate a new correlation ID if not found
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Extract AWS Request ID from Lambda context
 */
export const extractAwsRequestId = (context: Context): string => {
  return context.awsRequestId || 'unknown-request-id';
};

/**
 * Serialize error object for logging
 */
export const serializeError = (err: unknown): Record<string, unknown> => {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: (err as { code?: string }).code,
    };
  }

  if (typeof err === 'object' && err !== null) {
    return {
      name: 'UnknownError',
      message: String(err),
      data: err,
    };
  }

  return {
    name: 'UnknownError',
    message: String(err),
  };
};

/**
 * Log HTTP request/response
 */
export const logHttpRequest = (
  logger: Logger,
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  correlationId?: string
): void => {
  const logEntry = {
    event: 'http_request',
    method,
    path,
    statusCode,
    duration,
    correlationId,
  };

  if (statusCode >= 500) {
    logger.error(logEntry);
  } else if (statusCode >= 400) {
    logger.warn(logEntry);
  } else {
    logger.info(logEntry);
  }
};

/**
 * Create a performance timer
 */
export const createPerformanceTimer = (
  logger: Logger,
  operation: string,
  correlationId?: string
): PerformanceTimer => {
  const startTime = Date.now();

  return {
    end: () => {
      const duration = Date.now() - startTime;
      logger.info({
        event: 'performance_timer',
        operation,
        duration,
        correlationId,
      });
    },
  };
};

/**
 * Extract Lambda context from event (for backward compatibility)
 */
export const extractLambdaContext = (event: {
  requestContext?: {
    requestId?: string;
    authorizer?: {
      userId?: string;
      organizationId?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  headers?: {
    'x-request-id'?: string;
    'x-correlation-id'?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}): LoggerContext => {
  const context: LoggerContext = {};

  // Extract request ID from Lambda request context
  if (event.requestContext?.requestId) {
    context.requestId = event.requestContext.requestId as string;
  }

  // Extract from headers
  if (event.headers) {
    if (event.headers['x-request-id']) {
      context.requestId = event.headers['x-request-id'] as string;
    }
    if (event.headers['x-correlation-id']) {
      context.correlationId = event.headers['x-correlation-id'] as string;
    }
  }

  // Extract user context from authorizer
  if (event.requestContext?.authorizer) {
    const authorizer = event.requestContext.authorizer;
    if (authorizer.userId) {
      context.userId = authorizer.userId as string;
    }
    if (authorizer.organizationId) {
      context.organizationId = authorizer.organizationId as string;
    }
  }

  return context;
};

/**
 * Default logger instance
 */
export const logger = createLogger();

/**
 * Export default logger instance
 */
export default logger;
