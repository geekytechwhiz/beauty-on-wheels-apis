/**
 * @api-hub/event-platform — reliability (publish, consume, idempotency, retry, DLQ) and
 * event envelopes. Use `@api-hub/middleware` for Lambda execution (context, log, trace) only.
 */
export { createConsumerHandler } from '../platform/consumer-sdk';
