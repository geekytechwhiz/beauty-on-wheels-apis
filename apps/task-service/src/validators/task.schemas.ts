import { z } from 'zod';

/** HTTP body shapes — structural type checks only; business rules live in task-core. */

/** Who completes a task — `patient` | `careTeamRole` | `user` | `orgStaff` | `system`. */
export const assignedToTypeSchema = z.enum([
  'patient',
  'careTeamRole',
  'user',
  'orgStaff',
  'system',
]);

export const createMonitoringActionHttpBodySchema = z
  .object({
    patientId: z.string(),
    patientDisplayName: z.string(),
    carePlanInstanceId: z.string(),
    monitoringInstanceId: z.string(),
    taskBehaviorCode: z.string(),
    assignedToType: assignedToTypeSchema,
    assignedToStaffId: z.string().optional(),
    assignedToStaffDisplayName: z.string().optional(),
    dueWindowStart: z.number(),
    dueWindowEnd: z.number(),
    reminderContext: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const createRuntimeTaskHttpBodySchema = z
  .object({
    patientId: z.string().trim(),
    patientDisplayName: z.string().trim(),
    runtimeTaskSource: z.string(),
    taskBehaviorCode: z.string().trim(),
    taskDisplayGroup: z.string().trim(),
    displayTitle: z.string().trim(),
    assignedToType: assignedToTypeSchema,
    displayToPatient: z.boolean(),
    carePlanInstanceId: z.string().trim().optional(),
    workflowStage: z.string().trim().optional(),
    description: z.string().optional(),
    assignedToStaffId: z.string().optional(),
    assignedToStaffDisplayName: z.string().optional(),
    actionTargetId: z.string().trim().optional(),
    completionSourceType: z.string().optional(),
    completionSourceReferenceId: z.string().optional(),
    dueWindowStart: z.number().optional(),
    dueWindowEnd: z.number().optional(),
    reminderEnabled: z.boolean().optional(),
    requiredForStageCompletion: z.boolean().optional(),
    displayAsChecklistItem: z.boolean().optional(),
  })
  .strict();

export const carePlanLinkageMaterializationSchema = z
  .object({
    carePlanTaskLinkageId: z.string(),
    sourceTaskTemplateVersionId: z.string().optional(),
    taskBehaviorCode: z.string(),
    taskDisplayGroup: z.string(),
    displayTitle: z.string(),
    assignedToType: assignedToTypeSchema,
    displayToPatient: z.boolean(),
    description: z.string().optional(),
    assignedToStaffId: z.string().optional(),
    assignedToStaffDisplayName: z.string().optional(),
    actionTargetId: z.string().optional(),
    completionSourceType: z.string().optional(),
    completionSourceReferenceId: z.string().optional(),
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
    patientId: z.string(),
    patientDisplayName: z.string(),
    carePlanInstanceId: z.string(),
    taskGenerationTrigger: z.string(),
    workflowStage: z.string().optional(),
    dryRun: z.boolean().optional(),
    actorType: z.string().optional(),
    actorId: z.string().optional(),
    sourceLinkageContext: z
      .object({
        linkages: z.array(carePlanLinkageMaterializationSchema),
      })
      .strict(),
  })
  .strict();

export const updateAssignedStaffHttpBodySchema = z
  .object({
    actorId: z.string(),
    assignedToStaffId: z.string(),
    assignedToStaffDisplayName: z.string(),
    reason: z.string().optional(),
  })
  .strict();

export type UpdateAssignedStaffHttpBody = z.infer<typeof updateAssignedStaffHttpBodySchema>;

export const updateTaskStateHttpBodySchema = z
  .object({
    action: z.enum(['complete', 'dismiss', 'cancel', 'markMissed']),
    actorId: z.string(),
    actorType: assignedToTypeSchema,
    expectedCurrentState: z.enum([
      'open',
      'scheduled',
      'active',
      'completed',
      'missed',
      'dismissed',
      'cancelled',
    ]),
    reason: z.string().optional(),
    evidencePayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type UpdateTaskStateHttpBody = z.infer<typeof updateTaskStateHttpBodySchema>;

const reminderChannelSchema = z.enum(['push', 'sms', 'email', 'inApp']);

export const updateReminderSettingsHttpBodySchema = z
  .object({
    actorId: z.string(),
    reminderEnabled: z.boolean(),
    reminderSettings: z
      .object({
        channels: z.array(reminderChannelSchema).optional(),
        quietHoursRespected: z.boolean().optional(),
        scheduleAnchor: z.enum(['dueWindowStart', 'dueWindowEnd']).optional(),
        offsetMs: z.number().int().optional(),
        quietHoursBufferMs: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    reason: z.string().optional(),
  })
  .strict();

export type UpdateReminderSettingsHttpBody = z.infer<typeof updateReminderSettingsHttpBodySchema>;

const workflowStageSchema = z.enum(['onboarding', 'ongoing', 'review', 'closure']);

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
    actorId: z.string().min(1),
    reason: z.string().optional(),
    displayTitle: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    displayToPatient: z.boolean().optional(),
    requiredForStageCompletion: z.boolean().optional(),
    displayAsChecklistItem: z.boolean().optional(),
    workflowStage: workflowStageSchema.optional(),
    actionTargetId: z.string().nullable().optional(),
    completionSourceType: z.string().nullable().optional(),
    completionSourceReferenceId: z.string().nullable().optional(),
    patientDisplayName: z.string().min(1).optional(),
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

