export type { BaseEvent, EventEnvelope, EventMetadata } from './base-event';
export type { EventEnvelopeV2, EventMetaBlock } from './nested-envelope';
export { toBaseEventFromNested, toNestedEventEnvelope } from './nested-envelope';
export {
  EventSerializationError,
  serializeBaseEvent,
} from './serialize-base-event';
export {
  EventValidationError,
  validateBaseEvent,
} from './validate-base-event';
