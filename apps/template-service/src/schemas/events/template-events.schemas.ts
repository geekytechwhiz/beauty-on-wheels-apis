import { z } from 'zod';

export const TEMPLATE_EVENT_TYPES = {
  published: 'Template.Published.v1',
  carePlanCreated: 'CarePlan.Created.v1',
  carePlanAssigned: 'CarePlan.Assigned.v1',
} as const;

export const templatePublishedV1PayloadSchema = z.object({
  type: z.literal('Template.Published.v1'),
  templateId: z.string().min(1),
  orgId: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});


export const carePlanCreatedV1PayloadSchema = z.object({
  patientId: z.string(),
  templateId: z.string(),
  orgId: z.string(),
  templateVersion: z.string().optional(),
}).describe(JSON.stringify({
  eventType: 'careplan.created',
  version: '1.0.0',
  source: 'template-service',
}));

export const carePlanAssignedV1PayloadSchema = z.object({
  carePlanId: z.string().min(1),
  patientId: z.string().min(1),
  templateId: z.string().min(1),
  version: z.string().min(1),
  orgId: z.string().min(1),
});

export type TemplatePublishedV1Payload = z.infer<typeof templatePublishedV1PayloadSchema>;
export type CarePlanCreatedV1Payload = z.infer<typeof carePlanCreatedV1PayloadSchema>;
export type CarePlanAssignedV1Payload = z.infer<typeof carePlanAssignedV1PayloadSchema>;
