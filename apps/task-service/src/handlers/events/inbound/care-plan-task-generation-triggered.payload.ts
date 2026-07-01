import { z } from 'zod';

import type { CarePlanTaskGenerationIngressInput } from '@api-hub/task-core';

import { generateCarePlanTasksHttpBodySchema } from '../../../validators/task.schemas';

/**
 * EventBridge `payload` for care-plan task generation (`CarePlanTaskGenerationTriggered.v1`).
 */
export const carePlanTaskGenerationTriggeredPayloadSchema: z.ZodType<CarePlanTaskGenerationIngressInput> =
  generateCarePlanTasksHttpBodySchema.extend({
    organizationId: z.string().min(1),
  });

export type CarePlanTaskGenerationTriggeredPayload = CarePlanTaskGenerationIngressInput;
