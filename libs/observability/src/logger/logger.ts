import { Logger as PowertoolsLogger } from '@aws-lambda-powertools/logger';

import { getConfig, type LogLevelName } from '../config/config.js';
import { getLoggerContext, type LoggerContext } from '../core/context.js';
import { normalizeLoggerContext } from '../core/normalize-context.js';
import { redactPiiValue } from '../core/pii.js';
import { passesLevelFilter, passesSampling } from './level-sampling.js';
import type { LogEntry, LoggerOptions } from './types.js';
import { serializeError } from './serialize-error.js';

const METHOD_TO_LEVEL: Record<'debug' | 'info' | 'warn' | 'error', LogLevelName> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

function applyRequestResponseBlock(payload: Record<string, unknown>): void {
  if (!('request' in payload) && !('response' in payload)) return;
  if (payload.request !== undefined) {
    payload.request = '[BLOCKED]';
  }
  if (payload.response !== undefined) {
    payload.response = '[BLOCKED]';
  }
  payload.logPolicyWarning = 'Full request/response logging is not allowed';
}

function validateStructuredPolicy(
  payload: Record<string, unknown>,
  enforce: boolean,
  violationsToStderr: boolean
): boolean {
  if (!enforce) {
    applyRequestResponseBlock(payload);
    return true;
  }

  applyRequestResponseBlock(payload);

  const eventOk = typeof payload.event === 'string' && payload.event.length > 0;
  const messageOk = typeof payload.message === 'string' && payload.message.length > 0;
  if (!eventOk || !messageOk) {
    if (violationsToStderr) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          policyViolation: true,
          reason: 'structured_log_requires_event_and_message',
        })
      );
    }
    return false;
  }

  return true;
}

function createPowertoolsLogger(serviceName: string): PowertoolsLogger {
  return new PowertoolsLogger({
    serviceName,
    logLevel: 'DEBUG',
  });
}

const powertoolsRegistry = new WeakMap<object, PowertoolsLogger>();

const coldStartEmittedByPowertools = new WeakMap<PowertoolsLogger, boolean>();

function coldStartFlagFor(powertools: PowertoolsLogger): boolean {
  if (coldStartEmittedByPowertools.has(powertools)) {
    return false;
  }
  coldStartEmittedByPowertools.set(powertools, true);
  return true;
}

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
    powertoolsRegistry.set(this as object, powertoolsLogger);
  }

  getContext(): LoggerContext {
    return this.context ?? {};
  }

  getOptions(): LoggerOptions {
    return this.options ?? {};
  }

  private buildPayload(entry: LogEntry): Record<string, unknown> | null {
    const config = getConfig();
    const runtimeContext = normalizeLoggerContext(getLoggerContext());
    const staticContext = normalizeLoggerContext(this.context ?? {});
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

    if (!validateStructuredPolicy(merged, config.enforceLogPolicy, config.logPolicyViolationsToStderr)) {
      return null;
    }

    merged.coldStart = coldStartFlagFor(this.powertools);

    if (config.redactPII) {
      return redactPiiValue(merged, config) as Record<string, unknown>;
    }

    return merged;
  }

  private log(levelKey: 'debug' | 'info' | 'warn' | 'error', entry: LogEntry): void {
    const config = getConfig();
    const levelName = METHOD_TO_LEVEL[levelKey];
    if (!passesLevelFilter(levelName, config.logLevelFloor)) {
      return;
    }
    if (!passesSampling(levelName, config.sampling)) {
      return;
    }

    const payload = this.buildPayload(entry);
    if (payload === null) {
      return;
    }

    const message = String(payload.message ?? 'log-entry');
    this.powertools[levelKey](message, payload);
  }

  info(message: string, metadata?: LogEntry): void;
  info(entry: LogEntry): void;
  info(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('info', {
        ...(b ?? {}),
        message: a,
        event:
          typeof b?.event === 'string' && b.event.length > 0 ? b.event : 'application_log',
      });
    } else {
      this.log('info', a);
    }
  }

  warn(message: string, metadata?: LogEntry): void;
  warn(entry: LogEntry): void;
  warn(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('warn', {
        ...(b ?? {}),
        message: a,
        event:
          typeof b?.event === 'string' && b.event.length > 0 ? b.event : 'application_log',
      });
    } else {
      this.log('warn', a);
    }
  }

  error(message: string, metadata?: LogEntry): void;
  error(entry: LogEntry): void;
  error(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('error', {
        ...(b ?? {}),
        message: a,
        event:
          typeof b?.event === 'string' && b.event.length > 0 ? b.event : 'application_log',
      });
    } else {
      this.log('error', a);
    }
  }

  debug(message: string, metadata?: LogEntry): void;
  debug(entry: LogEntry): void;
  debug(a: string | LogEntry, b?: LogEntry): void {
    if (typeof a === 'string') {
      this.log('debug', {
        ...(b ?? {}),
        message: a,
        event:
          typeof b?.event === 'string' && b.event.length > 0 ? b.event : 'application_log',
      });
    } else {
      this.log('debug', a);
    }
  }
}

export const createLogger = (options?: LoggerOptions): Logger => {
  const serviceName =
    typeof options?.serviceName === 'string' && options.serviceName.length > 0
      ? options.serviceName
      : getConfig().serviceName;
  const powertools = createPowertoolsLogger(serviceName);
  return new Logger(powertools, undefined, options);
};

export const createChildLogger = (baseLogger: Logger, context: LoggerContext): Logger => {
  const shared = powertoolsRegistry.get(baseLogger as object);
  if (!shared) {
    throw new Error('@api-hub/observability: invalid base logger for createChildLogger');
  }
  const mergedContext = {
    ...baseLogger.getContext(),
    ...context,
  };
  return new Logger(shared, mergedContext, baseLogger.getOptions());
};
