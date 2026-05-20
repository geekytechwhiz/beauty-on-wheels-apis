import { configureObservability } from '../config/config';
import type { LogEntry, LoggerOptions } from './types';
import { getLogger } from './logger';

function applyLoggerOptions(options?: LoggerOptions): void {
  if (!options) return;
  const serviceName = options.serviceName ?? options.service;
  if (serviceName !== undefined || options.redactPII !== undefined) {
    configureObservability({
      ...(serviceName !== undefined ? { serviceName } : {}),
      ...(options.redactPII !== undefined ? { redactPII: options.redactPII } : {}),
    });
  }
}

/**
 * Structured logger compatible with legacy `@api-hub/logger` {@link LogEntry} call style
 * (`logger.info({ event: 'x', ... } )`), backed by {@link getLogger} and AsyncLocalStorage context.
 */
export class StructuredLogger {
  constructor(private readonly persistentKeys: Record<string, unknown> = {}) {}

  getPersistentKeys(): Record<string, unknown> {
    return { ...this.persistentKeys };
  }

  info(entry: LogEntry): void {
    const { event = 'log', ...rest } = entry;
    getLogger(this.persistentKeys).info(String(event), rest);
  }

  warn(entry: LogEntry): void {
    const { event = 'log', ...rest } = entry;
    getLogger(this.persistentKeys).warn(String(event), rest);
  }

  error(entry: LogEntry): void {
    const { event = 'log', err, error: err2, ...rest } = entry;
    const errVal = err ?? err2;
    getLogger(this.persistentKeys).error(String(event), errVal, rest);
  }

  debug(entry: LogEntry): void {
    const { event = 'log', ...rest } = entry;
    getLogger(this.persistentKeys).debug(String(event), rest);
  }

  http(entry: LogEntry): void {
    this.info(entry);
  }

  verbose(entry: LogEntry): void {
    this.debug(entry);
  }
}

/**
 * Create a service-level structured logger (legacy `@api-hub/logger` `createLogger` replacement).
 */
export function createLogger(options?: LoggerOptions): StructuredLogger {
  applyLoggerOptions(options);
  return new StructuredLogger();
}

/**
 * Create a child logger with merged persistent keys (legacy `createChildLogger` replacement).
 */
export function createChildLogger(
  parent: StructuredLogger | unknown,
  context: Record<string, unknown>,
): StructuredLogger {
  if (parent instanceof StructuredLogger) {
    return new StructuredLogger({
      ...parent.getPersistentKeys(),
      ...context,
    });
  }
  return new StructuredLogger({ ...context });
}

/** @deprecated Prefer {@link StructuredLogger} — kept as a type alias for migration from `@api-hub/logger`. */
export type Logger = StructuredLogger;

export const logger = new StructuredLogger();
