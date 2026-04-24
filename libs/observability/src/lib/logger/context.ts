import { AsyncLocalStorage } from 'node:async_hooks';

export interface LoggerContext {
  correlationId?: string;
  awsRequestId?: string;
  userId?: string;
  tenantId?: string;
  organizationId?: string;
  requestId?: string;
  functionName?: string;
  [key: string]: unknown;
}

const loggerContextStorage = new AsyncLocalStorage<LoggerContext>();

const normalizeContext = (context: LoggerContext): LoggerContext => {
  if (!context.tenantId && typeof context.organizationId === 'string') {
    return { ...context, tenantId: context.organizationId };
  }
  if (!context.organizationId && typeof context.tenantId === 'string') {
    return { ...context, organizationId: context.tenantId };
  }
  return context;
};

export const withLoggerContext = <T>(
  context: LoggerContext,
  fn: () => T | Promise<T>
): T | Promise<T> => {
  const current = loggerContextStorage.getStore();
  const merged = normalizeContext({
    ...(current ?? {}),
    ...context,
  });
  return loggerContextStorage.run(merged, fn);
};

export const getLoggerContext = (): LoggerContext => {
  const context = loggerContextStorage.getStore();
  return context ? normalizeContext(context) : {};
};

