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
export { createLogger } from './logger/base';
export { serializeError } from './logger/serialize-error';

export { 
  recordConsumerDeadLetter,
  recordConsumerDeliveryDisposition,
  recordConsumerDuplicateEvent,
  recordConsumerEventProcessed,
  recordConsumerFailure,
  recordConsumerRetry,
} from './metrics/consumer-metrics';

export { publishMiddlewarePipelineMetrics } from './metrics/middleware-metrics';

export { recordUpstreamRetryAttempts } from './metrics/upstream-metrics';

export {
  withHttpObservability,
  withLambdaObservability,
  
  type ApiGatewayLikeEvent,
} from './middleware/index';
