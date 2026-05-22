import { ALERT_REALTIME_EVENTS, type BaseEvent } from '@api-hub/event-platform';
import type { EventTransformer } from '@api-hub/event-platform';

import type { AlertCreateIngestPayload } from '../inbound/alert-create-ingest.payload';
 
 
export class AlertCreatedRealtimeTransformer implements EventTransformer {
  transform(event: BaseEvent<unknown>) {
    const payload = event.payload as AlertCreateIngestPayload;

    return {
      channel: 'ALERTS',
      eventType: ALERT_REALTIME_EVENTS.ALERT_CREATED,
      recipientIds: [],
      payload: {
        organizationId: payload.organizationId,
        patientId: payload.patientId,
        patientName: payload.patientName,
        priority: payload.priority,
        inputEventId: payload.inputEventId,
        inputType: payload.inputType,
        sourceType: payload.sourceType,
        groupingKey: payload.groupingKey,
      },
    };
  }
}

export const alertCreatedRealtimeTransformer = new AlertCreatedRealtimeTransformer();
