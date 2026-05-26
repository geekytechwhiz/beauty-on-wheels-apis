import {
  ALERT_REALTIME_EVENT_VERSION,
  ALERT_REALTIME_EVENTS,
  type BaseEvent,
} from '@api-hub/event-platform';
import type { EventTransformer } from '@api-hub/event-platform';

import type { AlertCreateIngestPayload } from '../inbound/alert-create-ingest.payload';
import { resolveAlertRealtimeNotifyScope } from './alert-realtime-notify-scope';

export class AlertCreatedRealtimeTransformer implements EventTransformer {
  transform(event: BaseEvent<unknown>) {
    const payload = event.payload as AlertCreateIngestPayload;
    const realtimeNotifyScope = resolveAlertRealtimeNotifyScope(payload);

    return {
      channel: 'ALERTS',
      eventType: ALERT_REALTIME_EVENTS.ALERT_CREATED,
      eventVersion: ALERT_REALTIME_EVENT_VERSION,
      recipientIds: [],
      payload: {
        organizationId: payload.organizationId,
        realtimeNotifyScope,
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
