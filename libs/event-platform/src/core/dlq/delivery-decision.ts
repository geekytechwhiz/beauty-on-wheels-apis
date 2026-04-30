/**
 * Compatibility re-exports — implementation lives in {@link ../policy/delivery-policy}.
 */
export {
  classifyAfterHandlerFailure,
  decideDeliveryDisposition,
  evaluateDeliveryPolicy,
  isNonRetryableHandlerError,
  outcomeWhenExhausted,
  resolveDeliveryDecision,
  type DecideDeliveryDisposition,
  type DeliveryDecision,
  type EvaluateDeliveryPolicyParams,
  type ResolveDeliveryDecisionParams,
  type TransportMode,
} from '../policy/delivery-policy';
