import { z } from 'zod';

export const missedReadingPayloadSchema = z.object({
  patientId: z.string(),
  organizationId: z.string(),
  readingType: z.string(),
  linkedEntityCode: z.string(),
  lastSuccessfulReadingTimestamp: z.number().int().nonnegative(),
  missedDuration: z.string(),
  triggeredAt: z.number().int().nonnegative(),
  appliesToType: z.string(),
  severityHint: z.string().optional(),
  inputEventId: z.string(),
  priority: z.string(),
  groupingKey: z.string(),
  triggerSummary: z.string().optional(),
  patientName: z.string().optional(),
  alertPolicyTemplateVersionId: z.string().optional(),
  thresholdTemplateVersionId: z.string().optional(),
  assignSlaMinutes: z.number().int().nonnegative().optional(),
  resolveSlaMinutes: z.number().int().nonnegative().optional(),
  carePlanInstanceId: z.string().optional(),
  packageAssignmentId: z.string().optional(),
});

export type MissedReadingEventPayload = z.infer<typeof missedReadingPayloadSchema>;
