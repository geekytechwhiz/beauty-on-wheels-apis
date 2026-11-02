import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';

const ChecklistItemSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  done: z.literal(true, { message: 'Every checklist item must be done' }),
});

/**
 * Body of both complete routes. Unknown fields (for example a client-supplied
 * completedAt) are dropped rather than rejected, because the server clock is
 * authoritative.
 */
export const CompleteVisitSchema = z.object({
  checklist: z.array(ChecklistItemSchema).min(1).max(50),
  evidenceObjectKeys: z.array(z.string().trim().min(1).max(512)).max(10).optional(),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  value.checklist.forEach((item, index) => {
    if (seen.has(item.itemId)) {
      context.addIssue({
        code: 'custom',
        path: ['checklist', index, 'itemId'],
        message: 'itemId must be unique',
      });
    }
    seen.add(item.itemId);
  });
});

export type CompleteVisitInput = z.infer<typeof CompleteVisitSchema>;

export const CompletionReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

export type CompletionReviewInput = z.infer<typeof CompletionReviewSchema>;

export const EvidenceUploadUrlSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
}).strict();

export function parseCompleteVisitBody(body: unknown): CompleteVisitInput {
  const result = CompleteVisitSchema.safeParse(body ?? {});
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  return result.data;
}

export function parseCompletionReviewBody(body: unknown): CompletionReviewInput {
  const result = CompletionReviewSchema.safeParse(body ?? {});
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  return result.data;
}

export function parseEvidenceUploadUrlBody(body: unknown): z.infer<typeof EvidenceUploadUrlSchema> {
  const result = EvidenceUploadUrlSchema.safeParse(body ?? {});
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  return result.data;
}
