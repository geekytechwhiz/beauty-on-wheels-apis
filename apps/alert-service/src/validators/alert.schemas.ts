/**
 * Zod schemas for HTTP bodies. `createAlertHttpBodySchema` is used from `validation/request.validators.ts`.
 * @see `docs/http-api-implementation-guide.md` §4–§5
 *
 * **Public create-alert body:** `inputEventId`, `inputType`, and `sourceType` are not in the JSON body; defaults are
 * applied inside {@link AlertService.createAlert} (`@api-hub/alert-integration`).
 */
import { CREATE_ALERT_DEFAULT_INPUT_TYPE } from '@api-hub/alert-integration';
import { z } from 'zod';

const inputTypeZ = z.enum([
  'THRESHOLD_BREACH',
  'MISSED_READING',
  'MISSING_DEVICE',
  'SYMPTOM_RISK_TRIGGER',
  'ENGAGEMENT_TRIGGER',
]);

const appliesToTypeZ = z.enum(['VITAL_SIGN', 'DEVICE', 'SYMPTOM', 'ENGAGEMENT']);
const severityHintZ = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const priorityZ = z.enum(['P0', 'P1', 'P2', 'P3']);

/**
 * Request body fields the UI may send (strict: unknown keys rejected).
 */
export const createAlertHttpBodySchema = z
  .object({
    patientId: z.string().min(1),
    carePlanInstanceId: z.string().min(1).optional(),
    packageAssignmentId: z.string().min(1).optional(),
    triggerTimestamp: z.string().min(1),
    appliesToType: appliesToTypeZ.optional(),
    linkedEntityCode: z.string().min(1).optional(),
    severityHint: severityHintZ.optional(),
    priority: priorityZ.optional(),
    alertPolicyTemplateVersionId: z.string().min(1).optional(),
    thresholdTemplateVersionId: z.string().min(1).optional(),
    groupingKey: z.string().min(1).optional(),
    triggerSummary: z.string().optional(),
    triggerSummaryTemplateCode: z.string().optional(),
    triggerSummaryParams: z.record(z.string(), z.unknown()).optional(),
    evidencePayload: z.record(z.string(), z.unknown()),
  })
  /** Reject `inputEventId`, `inputType`, `sourceType`, etc. if the client sends them — not HTTP inputs. */
  .strict()
  .superRefine((val, ctx) => {
    const ts = Date.parse(val.triggerTimestamp);
    if (Number.isNaN(ts)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'triggerTimestamp must be a valid ISO-8601 date-time', path: ['triggerTimestamp'] });
    }
    if ((val.appliesToType != null) !== (val.linkedEntityCode != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'appliesToType and linkedEntityCode must both be set or both omitted',
        path: ['appliesToType'],
      });
    }
  })
  .superRefine((val, ctx) => {
    const p = val.evidencePayload;
    if (!p || typeof p !== 'object' || Object.keys(p).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'evidencePayload must be a non-empty object', path: ['evidencePayload'] });
      return;
    }
    const ok = checkEvidenceForInputType(CREATE_ALERT_DEFAULT_INPUT_TYPE, p);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `evidencePayload shape is invalid for inputType ${CREATE_ALERT_DEFAULT_INPUT_TYPE}`,
        path: ['evidencePayload'],
      });
    }
  });

export type CreateAlertHttpBody = z.infer<typeof createAlertHttpBodySchema>;

function checkEvidenceForInputType(inputType: z.infer<typeof inputTypeZ>, payload: Record<string, unknown>): boolean {
  switch (inputType) {
    case 'THRESHOLD_BREACH':
      return 'metricCode' in payload || 'reading' in payload || 'metric' in payload;
    case 'MISSED_READING':
      return 'deviceId' in payload || 'readingType' in payload || 'window' in payload;
    case 'MISSING_DEVICE':
      return 'deviceId' in payload || 'deviceType' in payload;
    case 'SYMPTOM_RISK_TRIGGER':
      return 'symptomCode' in payload || 'symptom' in payload || 'riskScore' in payload;
    case 'ENGAGEMENT_TRIGGER':
      return 'engagementType' in payload || 'channel' in payload || 'context' in payload;
    default:
      return true;
  }
}

export const patchAlertBodySchema = z.object({
  alertState: z
    .enum(['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'DISMISSED'])
    .optional(),
  assignedToUserId: z.union([z.string().min(1), z.null()]).optional(),
  slaBreachIndicator: z.boolean().optional(),
});
