/**
 * Zod schemas for HTTP bodies. `createAlertHttpBodySchema` is used from `validation/request.validators.ts`.
 * @see `Alert-Service.yaml` CreateAlertRequest / evidencePayload (per-`inputType` shapes).
 *
 * **HTTP create-alert:** `inputEventId` (idempotency — supplied by the client UI), `inputType`, and `sourceType`
 * are required in the body; `organizationId` comes from the JWT. Optional `patientName` and `actorName` are
 * client-supplied display names (patient and authenticated caller). **Create HTTP** supports only `MISSED_READING` and `MISSING_DEVICE`;
 * `evidencePayload` is discriminated by `inputType` and must mirror top-level `inputType` (§5.1.3.1).
 */
import {
  ALERT_STATE,
  AlertDismissReasonCode,
  AlertResolveReasonCode,
} from '@api-hub/alert-core';
import { z } from 'zod';

const ALERT_STATE_ZOD_VALUES = [
  ALERT_STATE.UNASSIGNED,
  ALERT_STATE.ASSIGNED,
  ALERT_STATE.IN_PROGRESS,
  ALERT_STATE.WAITING,
  ALERT_STATE.RESOLVED,
  ALERT_STATE.DISMISSED,
] as const;

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
    inputEventId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
    inputType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), createAlertInputTypeZ),
    sourceType: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), sourceTypeZ),
    patientId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
    patientName: z.string().trim().min(1).optional(),
    actorName: z.string().trim().min(1).optional(),
    carePlanInstanceId: z.string().trim().min(1).optional(),
    packageAssignmentId: z.string().trim().min(1).optional(),
    triggerTimestamp: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)),
    severityHint: z.string().trim().pipe(severityHintZ).optional(),
    priority: z.string().trim().pipe(priorityZ).optional(),
    alertPolicyTemplateVersionId: z.string().trim().min(1).optional(),
    thresholdTemplateVersionId: z.string().trim().min(1).optional(),
    groupingKey: z.string().trim().min(1).optional(),
    triggerSummary: z.string().trim().optional(),
    triggerSummaryTemplateCode: z.string().trim().min(1).optional(),
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
  alertState: z.enum(ALERT_STATE_ZOD_VALUES).optional(),
  assignedToUserId: z.union([z.string().min(1), z.null()]).optional(),
  slaBreachIndicator: z.boolean().optional(),
});

/** Re-export for OpenAPI / callers that need the allowlist as an array. */
export const WORKFLOW_RESOLVE_REASON_CODES = Object.values(AlertResolveReasonCode) as readonly string[];
export const WORKFLOW_DISMISS_REASON_CODES = Object.values(AlertDismissReasonCode) as readonly string[];

const workflowResolveReasonZ = z.nativeEnum(AlertResolveReasonCode);
const workflowDismissReasonZ = z.nativeEnum(AlertDismissReasonCode);

const workflowWireActionZ = z.enum([
  'ASSIGN',
  'START_WORK',
  'MOVE_TO_WAITING',
  'RESUME_WORK',
  'RESOLVE',
  'DISMISS',
]);

/**
 * POST `/alerts/workflow` body (strict). Supports single or bulk operations.
 * - `alertIds`: required array of 1..100 alert ids for bulk or single requests.
 * Aliases: `MOVE_TO_WAITING` → WAIT; `RESUME_WORK` → RESUME.
 */
export const alertWorkflowBodySchema = z
  .object({
    alertIds: z
      .array(z.string().trim().min(1))
      .min(1, 'At least one alertId is required')
      .max(100, 'Maximum 100 alertIds per request'),
    action: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), workflowWireActionZ),
    assignedToUserId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)).optional(),
    reasonCode: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().min(1)).optional(),
    comment: z.string().optional(),
    closureComment: z.string().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
    clientRequestId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const nonTerminal = new Set(['ASSIGN', 'START_WORK', 'MOVE_TO_WAITING', 'RESUME_WORK']);
    if (nonTerminal.has(data.action)) {
      if (data.reasonCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'reasonCode is only valid for RESOLVE or DISMISS',
          path: ['reasonCode'],
        });
      }
    }

    if (data.action === 'ASSIGN' && !data.assignedToUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assignedToUserId is required for ASSIGN',
        path: ['assignedToUserId'],
      });
    }

    if (data.action === 'RESOLVE') {
      if (!data.reasonCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'reasonCode is required for RESOLVE',
          path: ['reasonCode'],
        });
        return;
      }
      const rc = workflowResolveReasonZ.safeParse(data.reasonCode);
      if (!rc.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown reasonCode for RESOLVE: ${data.reasonCode}`,
          path: ['reasonCode'],
        });
        return;
      }
      if (
        rc.data === AlertResolveReasonCode.Other &&
        !(data.comment?.trim() || data.closureComment?.trim())
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'comment (or closureComment) is required when reasonCode is OTHER',
          path: ['comment'],
        });
      }
    }

    if (data.action === 'DISMISS') {
      if (!data.reasonCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'reasonCode is required for DISMISS',
          path: ['reasonCode'],
        });
        return;
      }
      const dr = workflowDismissReasonZ.safeParse(data.reasonCode);
      if (!dr.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown reasonCode for DISMISS: ${data.reasonCode}`,
          path: ['reasonCode'],
        });
        return;
      }
      if (
        dr.data === AlertDismissReasonCode.Other &&
        !(data.comment?.trim() || data.closureComment?.trim())
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'comment (or closureComment) is required when reasonCode is OTHER',
          path: ['comment'],
        });
      }
    }
  });

export type AlertWorkflowHttpBody = z.infer<typeof alertWorkflowBodySchema>;

const assignmentActionZ = z.enum(['ASSIGN', 'ASSIGN_TO_SELF', 'REASSIGN', 'UNASSIGN']);

/**
 * POST `/alerts/assignment` body (strict).
 *
 * Note: DynamoDB transactions allow a maximum of 100 items. Because we write **one alert update + one activity row**
 * per alert, we cap this API at **50 alertIds** to guarantee atomic all-or-nothing behavior.
 */
export const alertAssignmentBodySchema = z
  .object({
    alertIds: z
      .array(z.string().trim().min(1))
      .min(1, 'At least one alertId is required')
      .max(50, 'Maximum 50 alertIds per request'),
    action: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), assignmentActionZ),
    assignToUserId: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if ((data.action === 'ASSIGN' || data.action === 'REASSIGN') && !data.assignToUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assignToUserId is required for ASSIGN and REASSIGN',
        path: ['assignToUserId'],
      });
    }
  });

export type AlertAssignmentHttpBody = z.infer<typeof alertAssignmentBodySchema>;

const priorityBandZ = z.enum(['P0', 'P1', 'P2', 'P3']);

/**
 * PATCH `/alerts/priority` body (strict).
 *
 * DynamoDB transactions allow a maximum of 100 items. Because we write **one alert update + one activity row**
 * per alert, we cap this API at **50 alertIds** to guarantee atomic all-or-nothing behavior.
 */
export const alertPriorityBodySchema = z
  .object({
    alertIds: z
      .array(z.string().trim().min(1))
      .min(1, 'At least one alertId is required')
      .max(50, 'Maximum 50 alertIds per request'),
    priority: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), priorityBandZ),
  })
  .strict();

export type AlertPriorityHttpBody = z.infer<typeof alertPriorityBodySchema>;

const listQueueKindZ = z.enum(['TEAM', 'MY', 'PATIENT']);

const listAlertStateFilterZ = z.enum(ALERT_STATE_ZOD_VALUES);

/** GET /alerts query string — `queue` enum, `patientId` rules in `superRefine`. */
export const listAlertsQuerySchema = z
  .object({
    queue: z.preprocess((v) => {
      if (v === undefined || v === null || v === '') return 'TEAM';
      const s = typeof v === 'string' ? v.trim().toUpperCase() : String(v).trim().toUpperCase();
      return s === '' ? 'TEAM' : s;
    }, listQueueKindZ),
    patientId: z.string().trim().min(1).optional(),
    state: z.string().trim().toUpperCase().pipe(listAlertStateFilterZ).optional(),
    /** Assignee filter: raw user id string (persisted field `assignedToUserId`; not an alert state label). */
    assignment: z
      .preprocess((v) => {
        if (v === undefined || v === null) return undefined;
        const t = String(v).trim();
        return t === '' ? undefined : t;
      }, z.string().min(1).optional()),
    priority: z.string().trim().toUpperCase().pipe(priorityZ).optional(),
    inputType: z.string().trim().min(1).optional(),
    dateFrom: z.string().trim().min(1).optional(),
    dateTo: z.string().trim().min(1).optional(),
    search: z.string().trim().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    nextToken: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.queue === 'PATIENT' && !data.patientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patientId is required when queue=PATIENT',
        path: ['patientId'],
      });
    }
    if (data.queue !== 'PATIENT' && data.patientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patientId is only allowed when queue=PATIENT',
        path: ['patientId'],
      });
    }
  });

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;

/** Note request body for POST /alerts/{alertId}/notes */
export const noteRequestBodySchema = z
  .object({
    comment: z.string().trim().min(1),
  })
  .strict();

export type NoteRequestBody = z.infer<typeof noteRequestBodySchema>;
