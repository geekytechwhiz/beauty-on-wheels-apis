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
    templateName: z.string().trim().min(1).max(150),
    templateType: z.string().trim().min(1).optional(),
    templateDescription: z.string().max(300).optional(),
    status: templateStatusZ.optional(),
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
  status: templateStatusZ.optional(),
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
  status: templateStatusZ.optional(),
  nextToken: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type GetMasterVersionsQuery = z.infer<typeof getMasterVersionsQuerySchema>;

export const templateIdPathSchema = z.object({
  templateId: z.string().trim().min(1),
});

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
