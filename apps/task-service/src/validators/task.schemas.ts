import { z } from 'zod';

/** HTTP body shapes — structural type checks only; business rules live in task-core. */

/** Required non-empty string (trimmed). */
export const nonEmptyStringSchema = z.string().trim().min(1);

/** Optional: omit field or send a non-empty trimmed string. */
export const optionalNonEmptyStringSchema = z.string().trim().min(1).optional();

/** Optional patch: omit, clear with null, or send non-empty trimmed string. */
export const optionalNullableNonEmptyStringSchema = z
  .union([z.string().trim().min(1), z.null()])
  .optional();

/**
 * Registry-backed metadata value codes — Zod enforces non-empty string shape only.
 * Labels are resolved from the metadata registry on read responses.
 */
export const metadataValueCodeSchema = nonEmptyStringSchema;

/** @deprecated Use metadataValueCodeSchema — kept for existing imports. */
export const assignedToTypeSchema = metadataValueCodeSchema;

/** @deprecated Use metadataValueCodeSchema — kept for existing imports. */
export const taskBehaviorCodeSchema = metadataValueCodeSchema;

/** @deprecated Use metadataValueCodeSchema — kept for existing imports. */
export const taskDisplayGroupSchema = metadataValueCodeSchema;

/** Domain enum — not registry-backed. */
const actorTypeSchema = z.enum(['patient', 'staff']);

/** Domain enums — not registry-backed. */
const taskRuntimeActionSchema = z.enum(['complete', 'dismiss', 'cancel', 'markMissed']);

const runtimeTaskStateSchema = z.enum([
  'open',
  'scheduled',
  'active',
  'completed',
  'missed',
  'dismissed',
  'cancelled',
]);

const reminderScheduleAnchorSchema = z.enum(['dueWindowStart', 'dueWindowEnd']);

export const createMonitoringActionHttpBodySchema = z
  .object({
    patientId: nonEmptyStringSchema,
    patientDisplayName: nonEmptyStringSchema,
    carePlanInstanceId: nonEmptyStringSchema,
    monitoringInstanceId: nonEmptyStringSchema,
    taskBehaviorCode: metadataValueCodeSchema,
    assignedToType: metadataValueCodeSchema,
    assignedToStaffId: optionalNonEmptyStringSchema,
    assignedToStaffDisplayName: optionalNonEmptyStringSchema,
    dueWindowStart: z.number(),
    dueWindowEnd: z.number(),
    reminderContext: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const createRuntimeTaskHttpBodySchema = z
  .object({
    patientId: nonEmptyStringSchema,
    patientDisplayName: nonEmptyStringSchema,
    runtimeTaskSource: metadataValueCodeSchema,
    taskBehaviorCode: metadataValueCodeSchema,
    taskDisplayGroup: metadataValueCodeSchema,
    displayTitle: nonEmptyStringSchema,
    assignedToType: metadataValueCodeSchema,
    displayToPatient: z.boolean(),
    carePlanInstanceId: optionalNonEmptyStringSchema,
    workflowStage: metadataValueCodeSchema.optional(),
    description: optionalNonEmptyStringSchema,
    assignedToStaffId: optionalNonEmptyStringSchema,
    assignedToStaffDisplayName: optionalNonEmptyStringSchema,
    actionTargetId: optionalNonEmptyStringSchema,
    completionSourceType: optionalNonEmptyStringSchema,
    completionSourceReferenceId: optionalNonEmptyStringSchema,
    dueWindowStart: z.number().optional(),
    dueWindowEnd: z.number().optional(),
    reminderEnabled: z.boolean().optional(),
    requiredForStageCompletion: z.boolean().optional(),
    displayAsChecklistItem: z.boolean().optional(),
  })
  .strict();

export const carePlanLinkageMaterializationSchema = z
  .object({
    carePlanTaskLinkageId: nonEmptyStringSchema,
    sourceTaskTemplateVersionId: optionalNonEmptyStringSchema,
    taskBehaviorCode: metadataValueCodeSchema,
    taskDisplayGroup: metadataValueCodeSchema,
    displayTitle: nonEmptyStringSchema,
    assignedToType: metadataValueCodeSchema,
    displayToPatient: z.boolean(),
    description: optionalNonEmptyStringSchema,
    assignedToStaffId: optionalNonEmptyStringSchema,
    assignedToStaffDisplayName: optionalNonEmptyStringSchema,
    actionTargetId: optionalNonEmptyStringSchema,
    completionSourceType: optionalNonEmptyStringSchema,
    completionSourceReferenceId: optionalNonEmptyStringSchema,
    dueWindowStart: z.number(),
    dueWindowEnd: z.number(),
    reminderEnabled: z.boolean().optional(),
    reminderSettings: z.record(z.string(), z.unknown()).optional(),
    requiredForStageCompletion: z.boolean().optional(),
    displayAsChecklistItem: z.boolean().optional(),
  })
  .strict();

export type CarePlanLinkageMaterializationHttpBody = z.infer<typeof carePlanLinkageMaterializationSchema>;

export const generateCarePlanTasksHttpBodySchema = z
  .object({
    patientId: nonEmptyStringSchema,
    patientDisplayName: nonEmptyStringSchema,
    carePlanInstanceId: nonEmptyStringSchema,
    taskGenerationTrigger: metadataValueCodeSchema,
    workflowStage: metadataValueCodeSchema.optional(),
    dryRun: z.boolean().optional(),
    actorType: optionalNonEmptyStringSchema,
    actorId: optionalNonEmptyStringSchema,
    sourceLinkageContext: z
      .object({
        linkages: z.array(carePlanLinkageMaterializationSchema),
      })
      .strict(),
  })
  .strict();

export const updateAssignedStaffHttpBodySchema = z
  .object({
    actorId: nonEmptyStringSchema,
    assignedToStaffId: nonEmptyStringSchema,
    assignedToStaffDisplayName: nonEmptyStringSchema,
    reason: optionalNonEmptyStringSchema,
  })
  .strict();

export type UpdateAssignedStaffHttpBody = z.infer<typeof updateAssignedStaffHttpBodySchema>;

export const updateTaskStateHttpBodySchema = z
  .object({
    action: taskRuntimeActionSchema,
    actorId: nonEmptyStringSchema,
    actorType: actorTypeSchema,
    expectedCurrentState: runtimeTaskStateSchema,
    reason: optionalNonEmptyStringSchema,
    evidencePayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type UpdateTaskStateHttpBody = z.infer<typeof updateTaskStateHttpBodySchema>;

export const updateReminderSettingsHttpBodySchema = z
  .object({
    actorId: nonEmptyStringSchema,
    reminderEnabled: z.boolean(),
    reminderSettings: z
      .object({
        channels: z.array(metadataValueCodeSchema).optional(),
        quietHoursRespected: z.boolean().optional(),
        scheduleAnchor: reminderScheduleAnchorSchema.optional(),
        offsetMs: z.number().int().optional(),
        quietHoursBufferMs: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    reason: optionalNonEmptyStringSchema,
  })
  .strict();

export type UpdateReminderSettingsHttpBody = z.infer<typeof updateReminderSettingsHttpBodySchema>;

const RUNTIME_TASK_MUTABLE_FIELD_KEYS = [
  'displayTitle',
  'description',
  'displayToPatient',
  'requiredForStageCompletion',
  'displayAsChecklistItem',
  'workflowStage',
  'actionTargetId',
  'completionSourceType',
  'completionSourceReferenceId',
  'patientDisplayName',
] as const;

export const updateRuntimeTaskHttpBodySchema = z
  .object({
    actorId: nonEmptyStringSchema,
    reason: optionalNonEmptyStringSchema,
    displayTitle: optionalNonEmptyStringSchema,
    description: optionalNullableNonEmptyStringSchema,
    displayToPatient: z.boolean().optional(),
    requiredForStageCompletion: z.boolean().optional(),
    displayAsChecklistItem: z.boolean().optional(),
    workflowStage: metadataValueCodeSchema.optional(),
    actionTargetId: optionalNullableNonEmptyStringSchema,
    completionSourceType: optionalNullableNonEmptyStringSchema,
    completionSourceReferenceId: optionalNullableNonEmptyStringSchema,
    patientDisplayName: optionalNonEmptyStringSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasMutable = RUNTIME_TASK_MUTABLE_FIELD_KEYS.some((key) => data[key] !== undefined);
    if (!hasMutable) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one metadata field is required',
        path: [],
      });
    }
  });

export type UpdateRuntimeTaskHttpBody = z.infer<typeof updateRuntimeTaskHttpBodySchema>;
