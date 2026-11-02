import { EventSchemaError } from '@api-hub/middleware';
import { z } from 'zod';

import { MAX_STATEMENT_ENTRIES } from '../domain/settlement';

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'must be a real calendar date');

const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}T/.test(value), 'must be an ISO-8601 timestamp');

const EntrySchema = z.object({
  source: z.enum(['COMPLETED_VISIT', 'ADJUSTMENT']).default('COMPLETED_VISIT'),
  visitId: z.string().trim().min(1).max(128).optional(),
  amountMinor: z.number().int().refine((value) => value !== 0, 'amountMinor cannot be 0'),
  note: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((entry, context) => {
  if (entry.source === 'COMPLETED_VISIT') {
    if (!entry.visitId) context.addIssue({ code: 'custom', path: ['visitId'], message: 'visitId is required for COMPLETED_VISIT' });
    if (entry.amountMinor < 0) context.addIssue({ code: 'custom', path: ['amountMinor'], message: 'COMPLETED_VISIT amount must be positive' });
  } else if (!entry.note) {
    context.addIssue({ code: 'custom', path: ['note'], message: 'note is required for ADJUSTMENT' });
  }
});

export const GenerateStatementSchema = z.object({
  vendorId: z.string().trim().min(1).max(128),
  periodStart: civilDate,
  periodEnd: civilDate,
  entries: z.array(EntrySchema).min(1).max(MAX_STATEMENT_ENTRIES),
}).strict().superRefine((value, context) => {
  if (value.periodEnd < value.periodStart) {
    context.addIssue({ code: 'custom', path: ['periodEnd'], message: 'periodEnd must not be before periodStart' });
  }
  const seen = new Set<string>();
  value.entries.forEach((entry, index) => {
    if (entry.source !== 'COMPLETED_VISIT' || !entry.visitId) return;
    if (seen.has(entry.visitId)) {
      context.addIssue({ code: 'custom', path: ['entries', index, 'visitId'], message: 'visitId appears twice' });
    }
    seen.add(entry.visitId);
  });
});

export const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
export const ApproveStatementSchema = z.object({ note: z.string().trim().min(1).max(1000).optional() }).strict();
export const MarkPaidSchema = z.object({
  transferReference: z.string().trim().min(3).max(100),
  paidAt: isoTimestamp,
}).strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  return result.data;
}
