/**
 * Zod schemas for HTTP bodies. `createAlertHttpBodySchema` is used from `validation/request.validators.ts`.
 * @see `Alert-Service.yaml` CreateAlertRequest / evidencePayload (per-`inputType` shapes).
 *
 * **HTTP create-alert:** `inputType` and `sourceType` are required in the body; `organizationId` comes from the JWT.
 * `inputEventId` is optional (idempotency key). **Create HTTP** supports only `MISSED_READING` and `MISSING_DEVICE`;
 * `evidencePayload` is discriminated by `inputType` and must mirror top-level `inputType` (§5.1.3.1).
 */
import { z } from 'zod';

/** Allowed `inputType` / `evidencePayload.inputType` for POST `/alerts` (§5.1.3.1). */
const createAlertInputTypeZ = z.enum(['MISSED_READING', 'MISSING_DEVICE']);

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

function preprocessTrimmedStringOptional(): z.ZodType<string | undefined> {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    return typeof v === 'string' ? v.trim() : v;
  }, z.string().min(1).optional());
}

function preprocessTrimmedOptionalNonEmpty(): z.ZodType<string | undefined> {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    return typeof v === 'string' ? v.trim() : v;
  }, z.string().min(1).optional());
}

const evEventTimestamp = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1));
const evSource = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), sourceTypeZ);
const evAppliesToType = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), appliesToTypeZ);
const evLinkedEntityCode = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1));

/**
 * HTTP `evidencePayload` for create: §5.1.3.1 common fields plus exactly one variant’s type-specific keys. Strict.
 */
const evidenceMissedReadingSchema = z.strictObject({
  eventTimestamp: evEventTimestamp,
  source: evSource,
  inputType: z.literal('MISSED_READING'),
  appliesToType: evAppliesToType,
  linkedEntityCode: evLinkedEntityCode,
  lastSuccessfulReadingTimestamp: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1),
  ),
  missedDuration: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
  readingType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
});

const evidenceMissingDeviceSchema = z.strictObject({
  eventTimestamp: evEventTimestamp,
  source: evSource,
  inputType: z.literal('MISSING_DEVICE'),
  appliesToType: evAppliesToType,
  linkedEntityCode: evLinkedEntityCode,
  deviceLinked: z.boolean(),
});

const evidencePayloadSchema = z.discriminatedUnion('inputType', [
  evidenceMissedReadingSchema,
  evidenceMissingDeviceSchema,
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
    inputEventId: preprocessTrimmedStringOptional(),
    inputType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), createAlertInputTypeZ),
    sourceType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), sourceTypeZ),
    patientId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
    carePlanInstanceId: preprocessTrimmedStringOptional(),
    packageAssignmentId: preprocessTrimmedStringOptional(),
    triggerTimestamp: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
    severityHint: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), severityHintZ).optional(),
    priority: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), priorityZ).optional(),
    alertPolicyTemplateVersionId: preprocessTrimmedStringOptional(),
    thresholdTemplateVersionId: preprocessTrimmedStringOptional(),
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

    if (val.evidencePayload.inputType !== val.inputType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'evidencePayload.inputType must match top-level inputType',
        path: ['evidencePayload', 'inputType'],
      });
    }

    if (val.sourceType !== val.evidencePayload.source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceType must match evidencePayload.source',
        path: ['sourceType'],
      });
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
    if (ev.inputType === 'MISSED_READING') {
      assertIsoDateTime(
        ev.lastSuccessfulReadingTimestamp,
        ['evidencePayload', 'lastSuccessfulReadingTimestamp'],
        'evidencePayload.lastSuccessfulReadingTimestamp',
        ctx,
      );
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
