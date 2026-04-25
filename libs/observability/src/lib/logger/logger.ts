import { Logger as PowertoolsLogger } from '@aws-lambda-powertools/logger';
import { getLoggerContext, type LoggerContext } from './context.js';
import { requireServiceName } from '../service-name.js';
import { redactPII, serializeError } from './utils.js';

export interface LoggerOptions {
  serviceName?: string;
  service?: string;
  logLevel?: string;
  redactPII?: boolean;
  [key: string]: unknown;
}

export interface LogEntry {
  event?: string;
  message?: string;
  err?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

let isColdStart = true;

const parseLogLevel = (logLevel?: string): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' => {
  const normalized = (logLevel ?? process.env.LOG_LEVEL ?? 'INFO').toUpperCase();
  switch (normalized) {
    case 'DEBUG':
      return 'DEBUG';
    case 'WARN':
      return 'WARN';
    case 'ERROR':
      return 'ERROR';
    default:
      return 'INFO';
  }
};

const createPowertoolsBaseLogger = (options?: LoggerOptions): PowertoolsLogger =>
  new PowertoolsLogger({
    serviceName:
      options?.serviceName ||
      (typeof options?.service === 'string' ? options.service : undefined) ||
      requireServiceName(),
    logLevel: parseLogLevel(options?.logLevel),
  });

export class Logger {
  private readonly powertools: PowertoolsLogger;
  private readonly context?: LoggerContext;
  private readonly options?: LoggerOptions;

  constructor(
    powertoolsLogger: PowertoolsLogger,
    context?: LoggerContext,
    options?: LoggerOptions
  ) {
    this.powertools = powertoolsLogger;
    this.context = context;
    this.options = options;
  }

  getContext(): LoggerContext {
    return this.context ?? {};
  }

  getOptions(): LoggerOptions {
    return this.options ?? {};
  }

  getPowertoolsLogger(): PowertoolsLogger {
    return this.powertools;
  }

  private normalizeContext(input: LoggerContext): LoggerContext {
    if (!input.tenantId && typeof input.organizationId === 'string') {
      return { ...input, tenantId: input.organizationId };
    }
    if (!input.organizationId && typeof input.tenantId === 'string') {
      return { ...input, organizationId: input.tenantId };
    }
    return input;
  }

  private buildPayload(entry: LogEntry): Record<string, unknown> {
    const runtimeContext = this.normalizeContext(getLoggerContext());
    const staticContext = this.normalizeContext(this.context ?? {});
    const merged = {
      ...runtimeContext,
      ...staticContext,
      ...entry,
    } as Record<string, unknown>;

    if (merged.err !== undefined) {
      merged.error = serializeError(merged.err);
      delete merged.err;
    } else if (merged.error !== undefined) {
      merged.error = serializeError(merged.error);
    }

    if (typeof merged.message !== 'string' || merged.message.length === 0) {
      merged.message = typeof merged.event === 'string' ? merged.event : 'log-entry';
    }

    if (isColdStart) {
      merged.coldStart = true;
      isColdStart = false;
    } else {
      merged.coldStart = false;
    }

    if (this.options?.redactPII) {
      return redactPII(merged) as Record<string, unknown>;
    }

    return merged;
  }

  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    entry: LogEntry
  ): void {
    const payload = this.buildPayload(entry);
    const message = String(payload.message ?? 'log-entry');
    this.powertools[level](message, payload);
  }

  info(message: string, metadata?: LogEntry): void;
  info(entry: LogEntry): void;
  info(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('info', { ...(b ?? {}), message: a });
    } else {
      this.log('info', a);
    }
  }

  warn(message: string, metadata?: LogEntry): void;
  warn(entry: LogEntry): void;
  warn(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('warn', { ...(b ?? {}), message: a });
    } else {
      this.log('warn', a);
    }
  }

  error(message: string, metadata?: LogEntry): void;
  error(entry: LogEntry): void;
  error(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('error', { ...(b ?? {}), message: a });
    } else {
      this.log('error', a);
    }
  }

  debug(message: string, metadata?: LogEntry): void;
  debug(entry: LogEntry): void;
  debug(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('debug', { ...(b ?? {}), message: a });
    } else {
      this.log('debug', a);
    }
  }
}

const defaultOptions: LoggerOptions = {};
const basePowertoolsLogger = createPowertoolsBaseLogger(defaultOptions);

export const createLogger = (options?: LoggerOptions): Logger => {
  if (!options || Object.keys(options).length === 0) {
    return new Logger(basePowertoolsLogger, undefined, defaultOptions);
  }
  return new Logger(createPowertoolsBaseLogger(options), undefined, options);
};

export const createChildLogger = (
  baseLogger: Logger,
  context: LoggerContext
): Logger => {
  const mergedContext = {
    ...baseLogger.getContext(),
    ...context,
  };

  return new Logger(
    baseLogger.getPowertoolsLogger(),
    mergedContext,
    baseLogger.getOptions()
  );
};

export const logger = createLogger();

export default logger;

