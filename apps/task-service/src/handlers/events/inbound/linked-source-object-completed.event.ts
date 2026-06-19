import { defineEvent } from '@api-hub/event-platform';

import { LINKED_SOURCE_OBJECT_COMPLETED_DETAIL_TYPE } from '../constants/task-inbound-events.constants';
import { linkedSourceObjectCompletedPayloadSchema } from './linked-source-object-completed.payload';

export type { LinkedSourceObjectCompletedPayload } from './linked-source-object-completed.payload';

export const LinkedSourceObjectCompletedEventSchema = defineEvent(
  linkedSourceObjectCompletedPayloadSchema,
  {
    eventType: LINKED_SOURCE_OBJECT_COMPLETED_DETAIL_TYPE,
    eventVersion: '1.0.0',
    source: 'task-service',
    transport: 'eventbridge',
  },
);
