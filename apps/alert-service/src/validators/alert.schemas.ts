/**
 * Zod schemas for HTTP bodies. `createAlertHttpBodySchema` is used from `validation/request.validators.ts`.
 * @see `Alert-Service.yaml` CreateAlertRequest / evidencePayload (per-`inputType` shapes).
 *
 * **HTTP create-alert:** `inputType` and `sourceType` are required in the body; `organizationId` comes from the JWT.
 * `inputEventId` is optional (UUID idempotency). `evidencePayload` is discriminated by `inputType` and must mirror top-level `inputType`.
 */
import { z } from 'zod';

const inputTypeZ = z.enum([
  'THRESHOLD_BREACH',
  'MISSED_READING',
  'MISSING_DEVICE',
  'SYMPTOM_RISK_TRIGGER',
  'ENGAGEMENT_TRIGGER',
]);

const sourceTypeZ = z.enum([
  'MONITORING_SERVICE',
  'DEVICE_MONITORING',
  'DEVICE_WORKFLOW',
  'SYMPTOM_ENGINE',
  'ENGAGEMENT_SERVICE',
  'USER_INTERFACE',
]);

const appliesToTypeZ = z.enum(['VITAL_SIGN', 'DEVICE', 'SYMPTOM', 'ENGAGEMENT']);
const severityHintZ = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const priorityZ = z.enum(['P0', 'P1', 'P2', 'P3']);
const comparisonOperatorZ = z.enum(['GT', 'LT', 'GTE', 'LTE', 'EQ']);

function preprocessTrimmedUuidOptional(): z.ZodType<string | undefined> {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    return typeof v === 'string' ? v.trim() : v;
  }, z.string().uuid().optional());
}

function preprocessTrimmedOptionalNonEmpty(): z.ZodType<string | undefined> {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    return typeof v === 'string' ? v.trim() : v;
  }, z.string().min(1).optional());
}

/** Common §5.1.3.1 fields on every `evidencePayload` (plus type-specific keys). */
const evidenceBaseSchema = z.object({
  eventTimestamp: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  source: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), sourceTypeZ),
  appliesToType: appliesToTypeZ.optional(),
  linkedEntityCode: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).optional()),
});

const evidenceThresholdBreachSchema = evidenceBaseSchema.extend({
  inputType: z.literal('THRESHOLD_BREACH'),
  observedValue: z.number(),
  unit: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  comparisonOperator: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), comparisonOperatorZ),
  thresholdValue: z.number().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  severityLevel: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), severityHintZ),
  readingTimestamp: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  readingSource: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
}).superRefine((data, ctx) => {
  const hasPoint = data.thresholdValue !== undefined;
  const hasRange =
    data.minValue !== undefined && data.maxValue !== undefined;
  const hasPartialRange =
    (data.minValue !== undefined) !== (data.maxValue !== undefined);
  if (hasPartialRange) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'minValue and maxValue must both be set for a range threshold',
      path: ['minValue'],
    });
    return;
  }
  if (!hasPoint && !hasRange) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide thresholdValue or both minValue and maxValue',
      path: ['thresholdValue'],
    });
  }
  if (hasPoint && hasRange) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use either thresholdValue or minValue/maxValue, not both',
      path: ['thresholdValue'],
    });
  }
});

const evidenceMissedReadingSchema = evidenceBaseSchema.extend({
  inputType: z.literal('MISSED_READING'),
  lastSuccessfulReadingTimestamp: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1),
  ),
  missedDuration: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  readingType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
});

const evidenceMissingDeviceSchema = evidenceBaseSchema.extend({
  inputType: z.literal('MISSING_DEVICE'),
  deviceLinked: z.boolean(),
});

const evidenceSymptomRiskSchema = evidenceBaseSchema.extend({
  inputType: z.literal('SYMPTOM_RISK_TRIGGER'),
  questionCode: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  responseValue: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  responseLabel: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).optional()),
  responseTimestamp: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
});

const evidenceEngagementSchema = evidenceBaseSchema.extend({
  inputType: z.literal('ENGAGEMENT_TRIGGER'),
  engagementEventCode: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  dueAt: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).optional()),
  missedDuration: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1).optional()),
});

const evidencePayloadSchema = z.discriminatedUnion('inputType', [
  evidenceThresholdBreachSchema,
  evidenceMissedReadingSchema,
  evidenceMissingDeviceSchema,
  evidenceSymptomRiskSchema,
  evidenceEngagementSchema,
]);

function assertIsoDateTime(value: string, path: (string | number)[], label: string, ctx: z.RefinementCtx): void {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label} must be a valid ISO-8601 date-time`,
      path,
    });
  }
}

/**
 * Request body (strict: unknown keys rejected). Organization ID is not an HTTP field.
 */
export const createAlertHttpBodySchema = z
  .object({
    inputEventId: preprocessTrimmedUuidOptional(),
    inputType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), inputTypeZ),
    sourceType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), sourceTypeZ),
    patientId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().uuid()),
    carePlanInstanceId: preprocessTrimmedUuidOptional(),
    packageAssignmentId: preprocessTrimmedUuidOptional(),
    triggerTimestamp: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
    appliesToType: appliesToTypeZ.optional(),
    linkedEntityCode: preprocessTrimmedOptionalNonEmpty(),
    severityHint: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), severityHintZ).optional(),
    priority: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), priorityZ).optional(),
    alertPolicyTemplateVersionId: preprocessTrimmedUuidOptional(),
    thresholdTemplateVersionId: preprocessTrimmedUuidOptional(),
    groupingKey: preprocessTrimmedOptionalNonEmpty(),
    triggerSummary: z.preprocess((v) => {
      if (v === undefined || v === null) return undefined;
      if (typeof v !== 'string') return v;
      const t = v.trim();
      return t === '' ? undefined : t;
    }, z.string().optional()),
    triggerSummaryTemplateCode: preprocessTrimmedOptionalNonEmpty(),
    triggerSummaryParams: z.record(z.string(), z.unknown()).optional(),
    evidencePayload: evidencePayloadSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    assertIsoDateTime(val.triggerTimestamp, ['triggerTimestamp'], 'triggerTimestamp', ctx);

    if ((val.appliesToType != null) !== (val.linkedEntityCode != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'appliesToType and linkedEntityCode must both be set or both omitted',
        path: ['appliesToType'],
      });
    }

    if (val.evidencePayload.inputType !== val.inputType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'evidencePayload.inputType must match top-level inputType',
        path: ['evidencePayload', 'inputType'],
      });
    }

    if (val.appliesToType != null) {
      if (val.evidencePayload.appliesToType !== val.appliesToType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidencePayload.appliesToType must match top-level appliesToType when set',
          path: ['evidencePayload', 'appliesToType'],
        });
      }
      if (val.linkedEntityCode != null && val.evidencePayload.linkedEntityCode !== val.linkedEntityCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'evidencePayload.linkedEntityCode must match top-level linkedEntityCode when set',
          path: ['evidencePayload', 'linkedEntityCode'],
        });
      }
    }

    if (val.triggerSummaryTemplateCode != null && val.triggerSummaryParams === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'triggerSummaryParams is required when triggerSummaryTemplateCode is set (use {} if no placeholders)',
        path: ['triggerSummaryParams'],
      });
    }

    const ev = val.evidencePayload;
    assertIsoDateTime(ev.eventTimestamp, ['evidencePayload', 'eventTimestamp'], 'evidencePayload.eventTimestamp', ctx);
    if (ev.inputType === 'THRESHOLD_BREACH') {
      assertIsoDateTime(
        ev.readingTimestamp,
        ['evidencePayload', 'readingTimestamp'],
        'evidencePayload.readingTimestamp',
        ctx,
      );
    }
    if (ev.inputType === 'MISSED_READING') {
      assertIsoDateTime(
        ev.lastSuccessfulReadingTimestamp,
        ['evidencePayload', 'lastSuccessfulReadingTimestamp'],
        'evidencePayload.lastSuccessfulReadingTimestamp',
        ctx,
      );
    }
    if (ev.inputType === 'SYMPTOM_RISK_TRIGGER') {
      assertIsoDateTime(
        ev.responseTimestamp,
        ['evidencePayload', 'responseTimestamp'],
        'evidencePayload.responseTimestamp',
        ctx,
      );
    }
    if (ev.inputType === 'ENGAGEMENT_TRIGGER' && ev.dueAt != null) {
      assertIsoDateTime(ev.dueAt, ['evidencePayload', 'dueAt'], 'evidencePayload.dueAt', ctx);
    }
  });

export type CreateAlertHttpBody = z.infer<typeof createAlertHttpBodySchema>;

export const patchAlertBodySchema = z.object({
  alertState: z
    .enum(['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'DISMISSED'])
    .optional(),
  assignedToUserId: z.union([z.string().min(1), z.null()]).optional(),
  slaBreachIndicator: z.boolean().optional(),
});
