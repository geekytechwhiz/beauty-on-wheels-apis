import { AsyncLocalStorage } from 'node:async_hooks';

import { normalizeLoggerContext } from './normalize-context.js';

export interface LoggerContext {
  correlationId?: string;
  awsRequestId?: string;
  /** AWS X-Ray root trace id (e.g. from `_X_AMZN_TRACE_ID`). */
  traceId?: string;
  /** Service name (from config / `event.__context`). */
  service?: string;
  /**
   * Handler operation name (e.g. `template.get`); from middleware `event.__context.operation`.
   */
  operation?: string;
  /** @deprecated Use `operation` for route/handler name; reserved for log category in new code. */
  event?: string;
  userId?: string;
  tenantId?: string;
  organizationId?: string;
  requestId?: string;
  functionName?: string;
  [key: string]: unknown;
}

const loggerContextStorage = new AsyncLocalStorage<LoggerContext>();

export const withLoggerContext = <T>(
  context: LoggerContext,
  fn: () => T | Promise<T>
): T | Promise<T> => {
  const current = loggerContextStorage.getStore();
  const merged = normalizeLoggerContext({
    ...(current ?? {}),
    ...context,
  });
  return loggerContextStorage.run(merged, fn);
};

export const getLoggerContext = (): LoggerContext => {
  const context = loggerContextStorage.getStore();
  return context ? normalizeLoggerContext(context) : {};
};
