import { defineEvent } from '@api-hub/event-platform';

import { ALERT_CREATE_INGEST_EVENT_DETAIL_TYPE } from '../constants/alert-create-ingest.constants';
import { alertCreateIngestPayloadSchema } from './alert-create-ingest.payload';

export type { AlertCreateIngestPayload } from './alert-create-ingest.payload';

export const CreateAlertEventSchema = defineEvent(alertCreateIngestPayloadSchema, {
  eventType: ALERT_CREATE_INGEST_EVENT_DETAIL_TYPE,
  eventVersion: '1.0.0',
  source: 'alert-service',
  transport: 'eventbridge',
});
