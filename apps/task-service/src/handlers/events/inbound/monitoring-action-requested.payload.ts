import { z } from 'zod';

import type { MonitoringActionIngressInput } from '@api-hub/task-core';

import { createMonitoringActionHttpBodySchema } from '../../../validators/task.schemas';

/**
 * EventBridge `payload` for monitoring action ingest (`MonitoringActionRequested.v1`).
 * HTTP body fields plus `organizationId` (JWT on HTTP).
 */
export const monitoringActionRequestedPayloadSchema: z.ZodType<MonitoringActionIngressInput> =
  createMonitoringActionHttpBodySchema.extend({
    organizationId: z.string().min(1),
  });

export type MonitoringActionRequestedPayload = MonitoringActionIngressInput;
