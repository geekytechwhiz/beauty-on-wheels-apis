export type { DlqConfig } from './dlq-config';
export {
  classifyAfterHandlerFailure,
  decideDeliveryDisposition,
  outcomeWhenExhausted,
} from './delivery-decision';
