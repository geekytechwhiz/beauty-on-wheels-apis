import { z } from 'zod';

const epochMsZ = z.number().int().nonnegative();

const taskBehaviorCodeZ = z.enum([
  'INSTRUCTION',
  'DOCUMENT_FORM',
  'UPLOAD_DOCUMENT',
  'DEVICE_SETUP',
  'EDUCATION_VIDEO',
  'EDUCATION_ARTICLE',
  'CARE_TEAM_TASK',
  'METRIC_CHECKIN',
  'SYMPTOM_CHECKIN',
]);

export const createMonitoringActionHttpBodySchema = z
  .object({
    patientId: z.string().min(1),
    carePlanInstanceId: z.string().min(1),
    monitoringInstanceId: z.string().min(1),
    taskBehaviorCode: taskBehaviorCodeZ,
    dueWindowStart: epochMsZ,
    dueWindowEnd: epochMsZ,
    reminderContext: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export type CreateMonitoringActionHttpBody = z.infer<typeof createMonitoringActionHttpBodySchema>;

const runtimeTaskSourceZ = z.enum(['serviceFlowRuntime', 'manualSystem']);
const taskDisplayGroupZ = z.enum(['action', 'learning', 'checkIn', 'staffTask']);
const assignedToTypeZ = z.enum(['patient', 'careTeam', 'provider', 'system']);
const ownerTypeZ = z.enum(['user', 'role', 'team']);
const workflowStageZ = z.enum(['onboarding', 'ongoing', 'review', 'closure']);

export const createRuntimeTaskHttpBodySchema = z
  .object({
    patientId: z.string().min(1),
    runtimeTaskSource: runtimeTaskSourceZ,
    taskBehaviorCode: taskBehaviorCodeZ,
    taskDisplayGroup: taskDisplayGroupZ,
    displayTitle: z.string().min(1),
    assignedToType: assignedToTypeZ,
    displayToPatient: z.boolean(),
    carePlanInstanceId: z.string().min(1).optional(),
    workflowStage: workflowStageZ.optional(),
    description: z.string().optional(),
    assignedToStaffId: z.string().min(1).optional(),
    ownerType: ownerTypeZ.optional(),
    ownerUserId: z.string().min(1).optional(),
    ownerRoleCode: z.string().min(1).optional(),
    ownerTeamId: z.string().min(1).optional(),
    ownerDisplayName: z.string().optional(),
    actionTargetId: z.string().min(1).optional(),
    completionSourceType: z.string().min(1).optional(),
    completionSourceReferenceId: z.string().min(1).optional(),
    dueWindowStart: epochMsZ.optional(),
    dueWindowEnd: epochMsZ.optional(),
    reminderEnabled: z.boolean().optional(),
    requiredForStageCompletion: z.boolean().optional(),
    displayAsChecklistItem: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.ownerType === 'user' && !data.ownerUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ownerUserId is required when ownerType is user',
        path: ['ownerUserId'],
      });
    }
    if (data.ownerType === 'role' && !data.ownerRoleCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ownerRoleCode is required when ownerType is role',
        path: ['ownerRoleCode'],
      });
    }
    if (data.ownerType === 'team' && !data.ownerTeamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ownerTeamId is required when ownerType is team',
        path: ['ownerTeamId'],
      });
    }
    if (
      data.dueWindowStart != null &&
      data.dueWindowEnd != null &&
      data.dueWindowEnd < data.dueWindowStart
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dueWindowEnd must be greater than or equal to dueWindowStart',
        path: ['dueWindowEnd'],
      });
    }
  })
  .transform((data) => {
    if (data.ownerType === 'user' && data.ownerUserId && !data.assignedToStaffId) {
      return { ...data, assignedToStaffId: data.ownerUserId };
    }
    return data;
  });

export type CreateRuntimeTaskHttpBody = z.infer<typeof createRuntimeTaskHttpBodySchema>;
