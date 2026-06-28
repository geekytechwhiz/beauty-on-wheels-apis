import { defineEvent } from '@api-hub/event-platform';

import { SERVICE_FLOW_ACTIVATED_DETAIL_TYPE } from '../constants/task-inbound-events.constants';
import { serviceFlowActivatedPayloadSchema } from './service-flow-activated.payload';

export type { ServiceFlowActivatedPayload } from './service-flow-activated.payload';

export const ServiceFlowActivatedEventSchema = defineEvent(serviceFlowActivatedPayloadSchema, {
  eventType: SERVICE_FLOW_ACTIVATED_DETAIL_TYPE,
  eventVersion: '1.0.0',
  source: 'task-service',
  transport: 'eventbridge',
});
