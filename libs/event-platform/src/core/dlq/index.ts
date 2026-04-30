export type { DlqConfig } from './dlq-config';

export {
  classifyAfterHandlerFailure,
  decideDeliveryDisposition,
  evaluateDeliveryPolicy,
  isNonRetryableHandlerError,
  outcomeWhenExhausted,
  resolveDeliveryDecision,
} from './delivery-decision';

export type {
  DecideDeliveryDisposition,
  DeliveryDecision,
  EvaluateDeliveryPolicyParams,
  ResolveDeliveryDecisionParams,
  TransportMode,
} from './delivery-decision';
