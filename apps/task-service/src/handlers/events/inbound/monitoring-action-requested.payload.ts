import { z } from 'zod';

import { createMonitoringActionHttpBodySchema } from '../../../validators/task.schemas';

/**
 * EventBridge `payload` for monitoring action ingest (`MonitoringActionRequested.v1`).
 * HTTP body fields plus `organizationId` (JWT on HTTP).
 */
export const monitoringActionRequestedPayloadSchema = createMonitoringActionHttpBodySchema.extend({
  organizationId: z.string().min(1),
});

export type MonitoringActionRequestedPayload = z.infer<typeof monitoringActionRequestedPayloadSchema>;
