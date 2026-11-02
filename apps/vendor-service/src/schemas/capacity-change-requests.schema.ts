import { EventSchemaError } from '@api-hub/middleware';
import { z } from 'zod';

import { COVERAGE_DECISIONS } from '../domain/capacity-change';

export const CreateCapacityChangeRequestSchema = z.object({
  commitmentId: z.string().trim().min(1).max(128),
  requestedQuantity: z.number().int().min(0).max(1000),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const ApproveCapacityChangeSchema = z.object({
  replacementCoverageDecision: z.object({
    decision: z.enum(COVERAGE_DECISIONS),
    note: z.string().trim().min(1).max(1000).optional(),
  }).strict().optional(),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

export const RejectCapacityChangeSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  return result.data;
}
