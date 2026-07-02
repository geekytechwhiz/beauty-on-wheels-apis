import { defineEvent } from '@api-hub/event-platform';

import { CARE_PLAN_TASK_GENERATION_TRIGGERED_DETAIL_TYPE } from '../constants/task-inbound-events.constants';
import { carePlanTaskGenerationTriggeredPayloadSchema } from './care-plan-task-generation-triggered.payload';

export type { CarePlanTaskGenerationTriggeredPayload } from './care-plan-task-generation-triggered.payload';

export const CarePlanTaskGenerationTriggeredEventSchema = defineEvent(
  carePlanTaskGenerationTriggeredPayloadSchema,
  {
    eventType: CARE_PLAN_TASK_GENERATION_TRIGGERED_DETAIL_TYPE,
    eventVersion: '1.0.0',
    source: 'task-service',
    transport: 'eventbridge',
  },
);
