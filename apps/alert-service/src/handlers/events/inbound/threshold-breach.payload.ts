import { z } from 'zod';

export const thresholdBreachPayloadSchema = z.object({
  patientId: z.string(),
  organizationId: z.string(),
  /** Monitoring measurement code that breached (e.g. `BP_SYSTOLIC`, `HR`); stored on evidence for values/threshold. */
  metric: z.string(),
  currentValue: z.number(),
  threshold: z.number(),
  severityHint: z.string().optional(),
  triggeredAt: z.number().int().nonnegative(),
  inputEventId: z.string(),
  priority: z.string(),
  groupingKey: z.string(),
  appliesToType: z.string(),
  linkedEntityCode: z.string(),
  triggerSummary: z.string().optional(),
  patientName: z.string().optional(),
  alertPolicyTemplateVersionId: z.string().optional(),
  thresholdTemplateVersionId: z.string().optional(),
  assignSlaMinutes: z.number().int().nonnegative().optional(),
  resolveSlaMinutes: z.number().int().nonnegative().optional(),
});

export type ThresholdBreachEventPayload = z.infer<typeof thresholdBreachPayloadSchema>;
