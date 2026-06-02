import { TEMPLATE_STATUS } from '@api-hub/template-core';
import { z } from 'zod';

const templateStatusZ = z.enum([
  TEMPLATE_STATUS.DRAFT,
  TEMPLATE_STATUS.SAVED,
  TEMPLATE_STATUS.IN_REVIEW,
  TEMPLATE_STATUS.PUBLISHED,
  TEMPLATE_STATUS.ARCHIVED,
  TEMPLATE_STATUS.DEPRECATED,
]);

export const createMasterTemplateBodySchema = z
  .object({
    templateCode: z.string().trim().min(1),
    // Some request shapes provide this as templateMetadata.templateName.
    templateName: z.string().trim().min(1).max(150).optional(),
    templateType: z.string().trim().min(1).optional(),
    templateDescription: z.string().max(300).optional(),
    // Accept raw string here; validator normalizes values like "Saved" -> "SAVED".
    status: z.string().trim().min(1).optional(),
    category: z.union([z.string(), z.array(z.string())]).optional(),
    condition: z.union([z.string(), z.array(z.string())]).optional(),
    conditions: z.array(z.string()).optional(),
    countries: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    specialty: z.array(z.string()).optional(),
    specialties: z.array(z.string()).optional(),
    version: z.number().int().positive().optional(),
    createdBy: z.string().optional(),
  })
  .passthrough();

export type CreateMasterTemplateBody = z.infer<typeof createMasterTemplateBodySchema>;

/** Query params for GET /templates/master (OpenAPI). `organizationId` validated only; GSI-1 filter in Sprint 2. */
export const listMasterTemplatesQuerySchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  condition: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  templateType: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
  specialty: z.string().trim().min(1).optional(),
  templateCode: z.string().trim().min(1).optional(),
  nextToken: z.string().trim().min(1).optional(),
});

export type ListMasterTemplatesQuery = z.infer<typeof listMasterTemplatesQuerySchema>;

export const getMasterVersionsQuerySchema = z.object({
  version: z.string().trim().min(1).optional(),
  resolve: z.enum(['ACTIVE', 'LATEST_PUBLISHED', 'LATEST_ANY']).optional(),
  status: z.string().trim().min(1).optional(),
  nextToken: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type GetMasterVersionsQuery = z.infer<typeof getMasterVersionsQuerySchema>;

export const templateIdPathSchema = z.object({
  templateId: z.string().trim().min(1),
});

export const templateConfigIdPathSchema = z.object({
  configId: z.string().trim().min(1),
});

export const listTemplateConfigQuerySchema = z.object({
  configType: z.enum(['TEMPLATE', 'ORG']).optional(),
  templateType: z.string().trim().min(1).optional(),
});

export const createTemplateConfigBodySchema = z
  .object({
    configType: z.enum(['TEMPLATE', 'ORG']),
    templateType: z.string().trim().min(1).optional(),
    configKey: z.string().trim().min(1).optional(),
    fileName: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]*\.json$/i)
      .optional(),
    id: z.string().trim().min(1).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
    version: z.number().int().positive().optional(),
  })
  .passthrough();

export const updateTemplateConfigBodySchema = z.object({}).passthrough();

export const templateVersionPathSchema = z.object({
  templateId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
});

export const updateMasterTemplateBodySchema = z
  .object({
    meta: z.record(z.string(), z.unknown()).optional(),
    steps: z.array(z.unknown()).optional(),
    links: z.record(z.string(), z.unknown()).optional(),
    carePlanAttributes: z.record(z.string(), z.unknown()).optional(),
    templateTypeConfig: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type UpdateMasterTemplateBody = z.infer<typeof updateMasterTemplateBodySchema>;

export const statusTransitionBodySchema = z
  .object({
    action: z.enum(['SUBMIT_REVIEW', 'PUBLISH', 'REJECT', 'ARCHIVE', 'DEPRECATE']),
    comment: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'REJECT' && !data.reason?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'reason is required when action is REJECT',
        path: ['reason'],
      });
    }
  });

export type StatusTransitionBody = z.infer<typeof statusTransitionBodySchema>;

export function parseGetMasterVersionsQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): GetMasterVersionsQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      params[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  return getMasterVersionsQuerySchema.parse(params);
}

export const cloneTemplateBodySchema = z.object({
  newTemplateName: z.string().trim().min(1).max(150).optional(),
  inheritLinks: z.boolean().optional(),
});

export type CloneTemplateBody = z.infer<typeof cloneTemplateBodySchema>;

export const orgTemplatePathSchema = z.object({
  organizationId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
});

export const orgClonePathSchema = z.object({
  organizationId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
});

export const listOrgTemplatesQuerySchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  condition: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  templateType: z.string().trim().min(1).optional(),
  specialty: z.string().trim().min(1).optional(),
  nextToken: z.string().trim().min(1).optional(),
});

export type ListOrgTemplatesQuery = z.infer<typeof listOrgTemplatesQuerySchema>;

export const updateOrgTemplateBodySchema = z
  .object({
    meta: z.record(z.string(), z.unknown()).optional(),
    overrides: z.record(z.string(), z.unknown()).optional(),
    steps: z.array(z.unknown()).optional(),
    links: z.record(z.string(), z.unknown()).optional(),
    carePlanAttributes: z.record(z.string(), z.unknown()).optional(),
    templateTypeConfig: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type UpdateOrgTemplateBody = z.infer<typeof updateOrgTemplateBodySchema>;

export const createOrgEnablementBodySchema = z.object({
  organizationId: z.string().trim().min(1),
  masterTemplateVersionId: z.string().trim().min(1),
  effectiveFrom: z.string().trim().min(1).optional(),
  effectiveTo: z.string().nullable().optional(),
});

export type CreateOrgEnablementBody = z.infer<typeof createOrgEnablementBodySchema>;

export const searchOrgEnablementsQuerySchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  masterTemplateVersionId: z.string().trim().min(1).optional(),
  nextToken: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type SearchOrgEnablementsQuery = z.infer<typeof searchOrgEnablementsQuerySchema>;

export const enablementIdPathSchema = z.object({
  enablementId: z.string().trim().min(1),
});

export const orgEnablementOrgPathSchema = z.object({
  orgId: z.string().trim().min(1),
});

export const updateOrgEnablementBodySchema = z
  .object({
    action: z.enum(['UPDATE', 'REVOKE']).optional(),
    effectiveFrom: z.string().trim().min(1).nullable().optional(),
    effectiveTo: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const action = data.action ?? 'UPDATE';
    if (action === 'UPDATE') {
      const hasFrom = data.effectiveFrom !== undefined && data.effectiveFrom !== null;
      const hasTo = data.effectiveTo !== undefined;
      if (!hasFrom && !hasTo) {
        ctx.addIssue({
          code: 'custom',
          message: 'effectiveFrom or effectiveTo is required when action is UPDATE',
          path: ['effectiveFrom'],
        });
      }
    }
  });

export type UpdateOrgEnablementBody = z.infer<typeof updateOrgEnablementBodySchema>;

export function parseSearchOrgEnablementsQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): SearchOrgEnablementsQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      params[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  return searchOrgEnablementsQuerySchema.parse(params);
}

export const listCompatibleTemplatesQuerySchema = z.object({
  condition: z.string().trim().min(1),
  country: z.string().trim().min(1),
  duration: z.string().trim().min(1).optional(),
  templateType: z.string().trim().min(1).optional(),
});

export type ListCompatibleTemplatesQuery = z.infer<typeof listCompatibleTemplatesQuerySchema>;

export function parseListCompatibleTemplatesQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): ListCompatibleTemplatesQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      params[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  return listCompatibleTemplatesQuerySchema.parse(params);
}

export function parseListOrgTemplatesQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): ListOrgTemplatesQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      params[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  return listOrgTemplatesQuerySchema.parse(params);
}

export function parseListMasterTemplatesQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): ListMasterTemplatesQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      params[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  return listMasterTemplatesQuerySchema.parse(params);
}
