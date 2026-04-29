import type { LoggerContext } from './context.js';

export function normalizeLoggerContext(context: LoggerContext): LoggerContext {
  if (!context.tenantId && typeof context.organizationId === 'string') {
    return { ...context, tenantId: context.organizationId };
  }
  if (!context.organizationId && typeof context.tenantId === 'string') {
    return { ...context, organizationId: context.tenantId };
  }
  return context;
}
