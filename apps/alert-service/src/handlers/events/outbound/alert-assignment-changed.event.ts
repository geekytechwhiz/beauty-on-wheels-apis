import { defineEvent } from '@api-hub/event-platform';
import { z } from 'zod';

export const AlertAssignmentChangedEventSchema = defineEvent(
  z.object({
    alertId: z.string(),
    patientId: z.string(),
    organizationId: z.string(),
    activityType: z.enum(['ALERT_ASSIGNED', 'ALERT_REASSIGNED']),
    previousAssignee: z.string().optional(),
    newAssignee: z.string().optional(),
    previousAssigneeDisplayName: z.string().optional(),
    newAssigneeDisplayName: z.string().optional(),
    performedBy: z.string(),
    performedByDisplayName: z.string().optional(),
    occurredAt: z.string(),
  }),
  {
    eventType: 'Alert.AssignmentChanged.v1',
    eventVersion: '1.0.0',
    source: 'alert-service',
    transport: 'eventbridge',
  },
);
