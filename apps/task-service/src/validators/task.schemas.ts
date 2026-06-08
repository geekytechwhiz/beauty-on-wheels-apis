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
