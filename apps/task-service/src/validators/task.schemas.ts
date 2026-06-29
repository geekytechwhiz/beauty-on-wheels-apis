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

/** Who completes a task — `patient` | `careTeamRole` | `user` | `orgStaff` | `system`. */
export const assignedToTypeSchema = z.enum([
  'patient',
  'careTeamRole',
  'user',
  'orgStaff',
  'system',
]);

const actorTypeSchema = z.enum(['patient', 'staff']);

const taskRuntimeActionSchema = z.enum(['complete', 'dismiss', 'cancel']);

const runtimeTaskStateSchema = z.enum([
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
    taskBehaviorCode: z.string(),
    assignedToType: assignedToTypeSchema,
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
    runtimeTaskSource: z.string(),
    taskBehaviorCode: z.string().trim(),
    taskDisplayGroup: z.string().trim(),
    displayTitle: nonEmptyStringSchema,
    assignedToType: assignedToTypeSchema,
    displayToPatient: z.boolean(),
    carePlanInstanceId: optionalNonEmptyStringSchema,
    workflowStage: z.string().trim().optional(),
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
    taskBehaviorCode: z.string(),
    taskDisplayGroup: z.string(),
    displayTitle: nonEmptyStringSchema,
    assignedToType: assignedToTypeSchema,
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
    taskGenerationTrigger: z.string(),
    workflowStage: z.string().optional(),
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
        channels: z.array(z.string()).optional(),
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
    workflowStage: z.string().trim().optional(),
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
