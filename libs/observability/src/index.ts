export {
  getConfig,
  type ObservabilityConfig,
  type LogLevelName,
  type ObservabilityConfigInput,
  configureObservability,
} from './config/config';

export {
  getContext,
  withContext,
  getContext as getLoggerContext,
  withContext as withLoggerContext,
} from './core/context';

export type { Context } from './core/context';
export type LoggerContext = Partial<import('./core/context').Context>;

export { getLogger } from './logger/logger';
export { getPowertoolsLogger, getBaseLogger } from './logger/base';
export { serializeError } from './logger/serialize-error';

export type { LogEntry, LoggerOptions } from './logger/types';

export {
  createLogger,
  createChildLogger,
  StructuredLogger,
  logger,
  type Logger,
} from './logger/structured-logger';

export {
  recordConsumerDeadLetter,
  recordConsumerDeliveryDisposition,
  recordConsumerDuplicateevent: any,
  recordConsumerEventProcessed,
  recordConsumerFailure,
  recordConsumerRetry,
} from './metrics/consumer-metrics';

export { publishMiddlewarePipelineMetrics } from './metrics/middleware-metrics';

export { recordUpstreamRetryAttempts } from './metrics/upstream-metrics';

export {
  withHttpObservability,
  withLambdaObservability,

  type ApiGatewayLikeevent: any,
} from './middleware/index';

export {
  extractCorrelationId,
  extractAwsRequestId,
  resolveCorrelationIdForHttp,
} from './http/correlation';

export { logHttpRequest } from './http/log-http-request';

export { createPerformanceTimer } from './http/performance-timer';
