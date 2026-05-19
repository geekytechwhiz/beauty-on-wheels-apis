import { z } from 'zod';

const epochMsZ = z.number().int().nonnegative();

/**
 * EventBridge `payload` for alert create ingest (`CreateAlert.v1` envelope).
 * Mirrors {@link CreateAlertRequest} — producers supply `inputType`, `sourceType`; evidence optional.
 */
export const alertCreateIngestPayloadSchema = z.object({
  organizationId: z.string(),
  inputEventId: z.string(),
  inputType: z.string(),
  sourceType: z.string(),
  patientId: z.string(),
  patientName: z.string().trim().min(1),
  triggerTimestamp: epochMsZ,
  evidencePayload: z.record(z.string(), z.unknown()).optional(),
  priority: z.string(),
  groupingKey: z.string(),
  appliesToType: z.string().optional(),
  linkedEntityCode: z.string().optional(),
  severityHint: z.string().optional(),
  carePlanInstanceId: z.string().optional(),
  packageAssignmentId: z.string().optional(),
  alertPolicyTemplateVersionId: z.string().optional(),
  thresholdTemplateVersionId: z.string().optional(),
  triggerSummary: z.string().optional(),
  triggerSummaryTemplateCode: z.string().optional(),
  triggerSummaryParams: z.record(z.string(), z.unknown()).optional(),
  assignSlaMinutes: epochMsZ.optional(),
  resolveSlaMinutes: epochMsZ.optional(),
});

export type AlertCreateIngestPayload = z.infer<typeof alertCreateIngestPayloadSchema>;
