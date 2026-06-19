import { z } from 'zod';

import { createRuntimeTaskHttpBodySchema } from '../../../validators/task.schemas';

const serviceFlowTaskPayloadSchema = createRuntimeTaskHttpBodySchema.omit({
  patientId: true,
  runtimeTaskSource: true,
});

/**
 * EventBridge `payload` for service-flow runtime task create (`ServiceFlowActivated.v1`).
 */
export const serviceFlowActivatedPayloadSchema = z.object({
  organizationId: z.string().min(1),
  patientId: z.string(),
  triggerTimestamp: z.number().int().nonnegative(),
  taskPayload: serviceFlowTaskPayloadSchema,
});

export type ServiceFlowActivatedPayload = z.infer<typeof serviceFlowActivatedPayloadSchema>;
