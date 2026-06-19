import { z } from 'zod';

import { generateCarePlanTasksHttpBodySchema } from '../../../validators/task.schemas';

/**
 * EventBridge `payload` for care-plan task generation (`CarePlanTaskGenerationTriggered.v1`).
 */
export const carePlanTaskGenerationTriggeredPayloadSchema =
  generateCarePlanTasksHttpBodySchema.extend({
    organizationId: z.string().min(1),
  });

export type CarePlanTaskGenerationTriggeredPayload = z.infer<
  typeof carePlanTaskGenerationTriggeredPayloadSchema
>;
