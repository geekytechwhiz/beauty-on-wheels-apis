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

export const metadataPartitionTypeSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, 'metadata type must be alphanumeric, underscore, or hyphen');

export const metadataNameSegmentSchema = z
  .string()
  .min(1)
  .regex(/^[^/]+$/, 'metadata name must not contain slashes');

export const metadataVersionSegmentSchema = z.string().min(1).regex(/^[^/]+$/, 'version must not contain slashes');

export const metadataApplicabilitySchema = z.object({
  templateType: z.array(z.string()),
  category: z.array(z.string()),
  condition: z.array(z.string()),
  country: z.array(z.string()),
});

export const metadataConstraintsSchema = z
  .object({
    minSelections: z.number().optional(),
    maxSelections: z.number().optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    regex: z.string().optional(),
    maxLength: z.number().optional(),
    minLength: z.number().optional(),
  })
  .optional();

export const metadataDefinitionPayloadSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['ENUM', 'MULTI_ENUM', 'NUMERIC', 'BOOLEAN', 'STRING']),
  values: z.array(z.string()).optional(),
  defaultValue: z.unknown().optional(),
  metadataMode: z.enum(['Fixed', 'Expandable', 'FixedDefaultExpandable']),
  applicability: metadataApplicabilitySchema,
  constraints: metadataConstraintsSchema,
  status: z.enum(['ACTIVE', 'INACTIVE']),
  version: z.string().min(1),
});

export const metadataDefinitionUpsertBodySchema = z.object({
  type: z.enum(['ENUM', 'MULTI_ENUM', 'NUMERIC', 'BOOLEAN', 'STRING']),
  values: z.array(z.string()).optional(),
  defaultValue: z.unknown().optional(),
  metadataMode: z.enum(['Fixed', 'Expandable', 'FixedDefaultExpandable']),
  applicability: metadataApplicabilitySchema,
  constraints: metadataConstraintsSchema,
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

export const metadataListStatusQuerySchema = z.enum(['all', 'active', 'inactive']).optional();
