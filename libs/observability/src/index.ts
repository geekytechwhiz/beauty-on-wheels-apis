export {
  initObservability,
  getConfig,
  updateObservabilityConfig,
  type ObservabilityConfig,
  type LogLevelName,
  type ObservabilityConfigInput,
} from './config/config.js';

export {
  withLoggerContext,
  getLoggerContext,
  type LoggerContext,
} from './core/context.js';

export { Logger, createLogger, createChildLogger } from './logger/logger.js';
export { serializeError } from './logger/serialize-error.js';
export {
  logDbQuery,
  logExternalCall,
  logHttpRequest,
  type DbQueryLogData,
  type ExternalCallLogData,
  type HttpLogData,
} from './logger/controlled-logging.js';

export {
  publishMiddlewarePipelineMetrics,
  recordConsumerDeadLetter,
  recordConsumerDeliveryDisposition,
  recordConsumerDuplicateEvent,
  recordConsumerEventProcessed,
  recordConsumerFailure,
  recordConsumerRetry,
} from './metrics/index.js';

export {
  withHttpObservability,
  withLambdaObservability,
  type ApiGatewayLikeEvent,
} from './middleware/index.js';
