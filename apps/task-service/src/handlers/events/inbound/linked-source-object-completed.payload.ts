import { z } from 'zod';

/**
 * EventBridge `payload` for linked source completion (`LinkedSourceObjectCompleted.v1`).
 */
export const linkedSourceObjectCompletedPayloadSchema = z.object({
  organizationId: z.string().min(1),
  patientId: z.string(),
  completionSourceType: z.string(),
  completionSourceReferenceId: z.string(),
  completionEventId: z.string(),
  completedAt: z.number().int().nonnegative(),
});

export type LinkedSourceObjectCompletedPayload = z.infer<
  typeof linkedSourceObjectCompletedPayloadSchema
>;
