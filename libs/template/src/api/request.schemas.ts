import { z } from 'zod';

export const createTemplateBodySchema = z.object({
  templateId: z.string().min(1),
  version: z.string().min(1).optional(),
  type: z.enum(['MASTER', 'ORG']).default('ORG'),
  extendsTemplateId: z.string().min(1).optional(),
  extendsVersion: z.string().min(1).optional(),
  extendsBaseOrgId: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  rules: z.unknown().optional(),
  actions: z.unknown().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  createdBy: z.string().optional(),
});

export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

export const updateTemplateBodySchema = z.object({
  version: z.string().min(1),
  extendsTemplateId: z.string().min(1).optional(),
  extendsVersion: z.string().min(1).optional(),
  extendsBaseOrgId: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  rules: z.unknown().optional(),
  actions: z.unknown().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>;

export const executeTemplateBodySchema = z.object({
  context: z.record(z.string(), z.unknown()).default({}),
  version: z.string().optional(),
});

export type ExecuteTemplateBody = z.infer<typeof executeTemplateBodySchema>;
