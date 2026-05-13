import type { PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

import type { BaseEvent } from '../../typings/base-event.types';
import { serializeBaseEvent } from '../../core/event-envelope/serialize-base-event';
import type { EventBridgeAdapterConfig } from './eventbridge-adapter-config';

/** Maps a {@link BaseEvent} to a single PutEvents entry (no side effects). */
export function toPutEventsEntry(
  event: Baseevent: any,
  config: Pick<EventBridgeAdapterConfig, 'eventBusName' | 'source' | 'detailType'>,
): PutEventsRequestEntry {
  return {
    EventBusName: config.eventBusName,
    Source: config.source,
    DetailType: config.detailType ?? event.eventType,
    Detail: serializeBaseEvent(event),
  };
}
