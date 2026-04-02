import { assertValidRuleSet, type RuleSet } from '@api-hub/rule-engine';
import { z } from 'zod';
import { normalizeTemplateStatus } from '../domain/template-status';

const ruleSetSchema = z.custom<RuleSet>(
  (value) => {
    try {
      assertValidRuleSet(value);
      return true;
    } catch {
      return false;
    }
  },
  {
    message: 'rules must be a valid enterprise rule set',
  },
);

const templateProfileSchema = z.object({
  profileTemplateType: z.string().min(1),
  category: z.string().min(1),
  condition: z.string().min(1),
  country: z.string().min(1),
});

export const createTemplateBodySchema = z.object({
  templateId: z.string().min(1),
  version: z.string().min(1).optional(),
  type: z.enum(['MASTER', 'ORG']).default('ORG'),
  extendsTemplateId: z.string().min(1).optional(),
  extendsVersion: z.string().min(1).optional(),
  extendsBaseOrgId: z.string().min(1).optional(),
  profile: templateProfileSchema.optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  rules: ruleSetSchema.optional(),
  actions: z.unknown().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? undefined : normalizeTemplateStatus(s))),
  createdBy: z.string().optional(),
});

export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

export const updateTemplateBodySchema = z.object({
  version: z.string().min(1),
  extendsTemplateId: z.string().min(1).optional(),
  extendsVersion: z.string().min(1).optional(),
  extendsBaseOrgId: z.string().min(1).optional(),
  profile: templateProfileSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  rules: ruleSetSchema.optional(),
  actions: z.unknown().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? undefined : normalizeTemplateStatus(s))),
});

export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>;

export const executeTemplateBodySchema = z.object({
  context: z.record(z.string(), z.unknown()).default({}),
  version: z.string().optional(),
});

export type ExecuteTemplateBody = z.infer<typeof executeTemplateBodySchema>;

export const publishTemplateBodySchema = z.object({
  version: z.string().min(1),
});

export type PublishTemplateBody = z.infer<typeof publishTemplateBodySchema>;
