import { defineEvent } from '@api-hub/event-platform';
import { z } from 'zod';

const ReminderSettingsSchema = z
  .object({
    channels: z.array(z.string()).optional(),
    quietHoursRespected: z.boolean().optional(),
  })
  .passthrough();

export const TaskMetaStreamPayloadSchema = defineEvent(
  z
    .object({
      entityType: z.literal('RuntimeTaskInstance'),
      runtimeTaskInstanceId: z.string(),
      orgId: z.string(),
      patientId: z.string(),
      reminderEnabled: z.boolean().optional(),
      reminderSettings: ReminderSettingsSchema.optional(),
      currentState: z.string().optional(),
      dueWindowStart: z.number().optional(),
      dueWindowEnd: z.number().optional(),
    })
    .passthrough(),
  {
    eventType: 'RuntimeTaskInstance.MetaStreamChange',
    eventVersion: '1.0.0',
    source: 'task-service',
    transport: 'sqs',
  },
);
