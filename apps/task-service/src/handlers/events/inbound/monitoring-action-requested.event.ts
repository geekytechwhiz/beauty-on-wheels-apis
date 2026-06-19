import { defineEvent } from '@api-hub/event-platform';

import { MONITORING_ACTION_REQUESTED_DETAIL_TYPE } from '../constants/monitoring-action-requested.constants';
import { monitoringActionRequestedPayloadSchema } from './monitoring-action-requested.payload';

export type { MonitoringActionRequestedPayload } from './monitoring-action-requested.payload';

export const MonitoringActionRequestedEventSchema = defineEvent(monitoringActionRequestedPayloadSchema, {
  eventType: MONITORING_ACTION_REQUESTED_DETAIL_TYPE,
  eventVersion: '1.0.0',
  source: 'task-service',
  transport: 'eventbridge',
});
