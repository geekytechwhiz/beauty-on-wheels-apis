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
} from './core/context';

export { getLogger } from './logger/logger';
export { serializeError } from './logger/serialize-error';

export { 
  recordConsumerDeadLetter,
  recordConsumerDeliveryDisposition,
  recordConsumerDuplicateEvent,
  recordConsumerEventProcessed,
  recordConsumerFailure,
  recordConsumerRetry,
} from './metrics/consumer-metrics';

export {
  withHttpObservability,
  withLambdaObservability,
  
  type ApiGatewayLikeEvent,
} from './middleware/index';
