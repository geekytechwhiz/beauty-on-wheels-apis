import { z } from 'zod';

/** HTTP body shapes — structural type checks only; business rules live in task-core. */

export const createMonitoringActionHttpBodySchema = z
  .object({
    patientId: z.string(),
    patientDisplayName: z.string(),
    carePlanInstanceId: z.string(),
    monitoringInstanceId: z.string(),
    taskBehaviorCode: z.string(),
    dueWindowStart: z.number(),
    dueWindowEnd: z.number(),
    reminderContext: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export type CreateMonitoringActionHttpBody = z.infer<typeof createMonitoringActionHttpBodySchema>;

export const createRuntimeTaskHttpBodySchema = z
  .object({
    patientId: z.string(),
    patientDisplayName: z.string(),
    runtimeTaskSource: z.string(),
    taskBehaviorCode: z.string(),
    taskDisplayGroup: z.string(),
    displayTitle: z.string(),
    assignedToType: z.string(),
    displayToPatient: z.boolean(),
    carePlanInstanceId: z.string().optional(),
    workflowStage: z.string().optional(),
    description: z.string().optional(),
    assignedToStaffId: z.string().optional(),
    assignedToStaffDisplayName: z.string().optional(),
    actionTargetId: z.string().optional(),
    completionSourceType: z.string().optional(),
    completionSourceReferenceId: z.string().optional(),
    dueWindowStart: z.number().optional(),
    dueWindowEnd: z.number().optional(),
    reminderEnabled: z.boolean().optional(),
    requiredForStageCompletion: z.boolean().optional(),
    displayAsChecklistItem: z.boolean().optional(),
  })
  .strict();

export type CreateRuntimeTaskHttpBody = z.infer<typeof createRuntimeTaskHttpBodySchema>;

export const carePlanLinkageMaterializationSchema = z
  .object({
    carePlanTaskLinkageId: z.string(),
    sourceTaskTemplateVersionId: z.string().optional(),
    taskBehaviorCode: z.string(),
    taskDisplayGroup: z.string(),
    displayTitle: z.string(),
    assignedToType: z.string(),
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

export type GenerateCarePlanTasksHttpBody = z.infer<typeof generateCarePlanTasksHttpBodySchema>;

export const updateAssignedStaffHttpBodySchema = z
  .object({
    actorId: z.string(),
    assignedToStaffId: z.string(),
    assignedToStaffDisplayName: z.string(),
    reason: z.string().optional(),
  })
  .strict();

export type UpdateAssignedStaffHttpBody = z.infer<typeof updateAssignedStaffHttpBodySchema>;
