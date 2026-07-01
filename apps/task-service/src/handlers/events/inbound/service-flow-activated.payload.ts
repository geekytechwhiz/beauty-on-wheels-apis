import { z } from 'zod';

import type { ServiceFlowRuntimeTaskIngressInput } from '@api-hub/task-core';

import { createRuntimeTaskHttpBodySchema } from '../../../validators/task.schemas';

const serviceFlowTaskPayloadSchema = createRuntimeTaskHttpBodySchema.omit({
  patientId: true,
  runtimeTaskSource: true,
});

export type ServiceFlowActivatedPayload = Omit<ServiceFlowRuntimeTaskIngressInput, 'kind'> & {
  triggerTimestamp: number;
};

/**
 * EventBridge `payload` for service-flow runtime task create (`ServiceFlowActivated.v1`).
 */
export const serviceFlowActivatedPayloadSchema: z.ZodType<ServiceFlowActivatedPayload> = z.object({
  organizationId: z.string().min(1),
  patientId: z.string(),
  triggerTimestamp: z.number().int().nonnegative(),
  taskPayload: serviceFlowTaskPayloadSchema,
});
