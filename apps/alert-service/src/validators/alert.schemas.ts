import { z } from 'zod';

export const createAlertBodySchema = z.object({
  patientId: z.string().min(1),
  organizationId: z.string().min(1),
  inputEventId: z.string().min(1),
  inputType: z.string().min(1),
  priority: z.number().int().min(0).max(999),
  alertPolicyTemplateVersionId: z.string().optional(),
  groupingKey: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  triggerTimestamp: z.string().optional(),
});

export const patchAlertBodySchema = z.object({
  alertState: z.enum(['OPEN', 'ACK', 'IN_PROGRESS', 'CLOSED', 'ESCALATED']).optional(),
  assignedToUserId: z.union([z.string(), z.null()]).optional(),
  slaBreachIndicator: z.boolean().optional(),
});
