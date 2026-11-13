import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';

import { VENDOR_ISSUE_STATUS, VENDOR_ISSUE_TYPES } from '../types/vendor-issue.types';

const id = z.string().trim().min(1).max(128);

export const CreateIssueSchema = z.object({
  type: z.enum(VENDOR_ISSUE_TYPES),
  description: z.string().trim().min(1).max(2000),
  requestedHelp: z.string().trim().min(1).max(1000).optional(),
  visitId: id.optional(),
  communityId: id.optional(),
  commitmentId: id.optional(),
  /** Explicitly opt a visit into completion blocking; unresolved alone is not enough. */
  blocksVisit: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.blocksVisit === true && !value.visitId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['visitId'], message: 'visitId is required when blocksVisit is true' });
  }
});

export type CreateIssueInput = z.infer<typeof CreateIssueSchema>;

export const IssueStatusQuerySchema = z.enum([
  VENDOR_ISSUE_STATUS.OPEN,
  VENDOR_ISSUE_STATUS.TRIAGED,
  VENDOR_ISSUE_STATUS.ACTION_REQUIRED,
  VENDOR_ISSUE_STATUS.RESOLVED,
]);

export const AttachmentUploadUrlSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
}).strict();

export const ConfirmAttachmentSchema = z.object({
  objectKey: z.string().trim().min(1).max(512),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
}).strict();

export const TriageSchema = z.object({ note: z.string().trim().min(1).max(1000).optional() }).strict();
export const AssignSchema = z.object({
  assigneeUserId: id,
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();
export const ResolveSchema = z.object({
  outcome: z.string().trim().min(1).max(1000),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();
export const RequestActionSchema = z.object({ note: z.string().trim().min(1).max(1000) }).strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  return result.data;
}
