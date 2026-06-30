import { SHARE_SCOPE, TEMPLATE_STATUS, type PartialTemplateFieldRule } from '@api-hub/template-core';
import { z } from 'zod';

const shareScopeInputZ = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, '_').toUpperCase())
  .refine(
    (v) =>
      v === SHARE_SCOPE.PRIVATE ||
      v === SHARE_SCOPE.ORGANIZATION ||
      v === SHARE_SCOPE.PUBLIC,
    { message: 'shareScope must be Private, Organization, or Public' },
  );

const templateStatusZ = z.enum([TEMPLATE_STATUS.DRAFT, TEMPLATE_STATUS.PUBLISHED]);

const orgTemplateLifecycleStatusZ = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toUpperCase();
    if (normalized === 'PUBLISH') return TEMPLATE_STATUS.PUBLISHED;
    return normalized;
  },
  templateStatusZ,
);

export const templateLevelZ = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.enum(['MASTER', 'ORG', 'ORG_DERIVED', 'ORG_CARE_PLAN']),
);

export const fieldValuesSchema = z.record(z.string(), z.unknown());

/** Treat empty, `null`, and `undefined` query strings as no filter. */
const optionalListFilterZ = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return undefined;
  }
  return trimmed;
}, z.string().min(1).optional());

/** Query `active=true|false` (ignores null/empty). */
export const optionalActiveQueryZ = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim().toLowerCase();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return undefined;
    return trimmed;
  },
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === 'true' || v === '1';
    }),
);

export const organizationMetaSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional().nullable(),
});

const organizationMetaUpdatedZ = z
  .union([z.string().trim().min(1), z.number().finite()])
  .optional()
  .transform((val) => (val === undefined ? undefined : String(val)));

/** Required on POST /templates/derive. */
export const deriveOrganizationMetaSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  active: z.boolean().optional(),
  country: z.string().trim().min(1).optional(),
  updated: organizationMetaUpdatedZ,
  description: z.string().trim().optional().nullable(),
});

export const deriveTemplateBodySchema = z.object({
  organizationMeta: deriveOrganizationMetaSchema,
  categoryCode: z.string().trim().min(1),
  conditionCode: z.string().trim().min(1),
  templateType: z.string().trim().min(1),
  /**
   * Master id (`filterOptions.templateName.value`) or display name (`label`) from the org catalog.
   */
  templateId: z.string().trim().min(1),
});

export type DeriveTemplateBody = z.infer<typeof deriveTemplateBodySchema>;

/** PUT /templates/derive — enable or disable existing org subscription. */
export const updateOrgTemplateEnableBodySchema = z
  .object({
    organizationMeta: deriveOrganizationMetaSchema.optional(),
    organizationId: z.string().trim().min(1).optional(),
    templateId: z.string().trim().min(1),
    templateEnabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (!data.organizationMeta?.id && !data.organizationId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'organizationMeta.id or organizationId is required',
        path: ['organizationId'],
      });
    }
  });

export type UpdateOrgTemplateEnableBody = z.infer<typeof updateOrgTemplateEnableBodySchema>;

export const saveMasterTemplateBodySchema = z
  .object({
    shareScope: shareScopeInputZ.optional(),
    templateCode: z.string().trim().min(1).optional(),
    templateName: z.string().trim().min(1).max(150).optional(),
    templateType: z.string().trim().min(1).optional(),
    categoryCode: z.string().trim().min(1).optional(),
    conditionCode: z.string().trim().min(1).optional(),
    countryCodes: z.array(z.string()).optional(),
    languageCodes: z.array(z.string()).optional(),
    fieldValues: fieldValuesSchema.optional(),
    status: z.string().trim().min(1).optional(),
    active: z.boolean().optional(),
    measurementType: z.string().optional(),
  })
  .passthrough();

export type SaveMasterTemplateBody = z.infer<typeof saveMasterTemplateBodySchema>;

export const createMasterTemplateBodySchema = z
  .object({
    // Optional: when omitted, the validator derives templateCode from the template name.
    templateCode: z.string().trim().min(1).optional(),
    templateLevel: templateLevelZ.optional(),
    shareScope: shareScopeInputZ.optional(),
    categoryCode: z.string().trim().min(1).optional(),
    conditionCode: z.string().trim().min(1).optional(),
    countryCodes: z.array(z.string()).optional(),
    languageCodes: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    measurementType: z.string().optional(),
    fieldValues: fieldValuesSchema.optional(),
    templateMetadata: z.record(z.string(), z.unknown()).optional(),
    templateProfile: z.record(z.string(), z.unknown()).optional(),
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

/** POST /templates (create) and POST /templates/{templateId} (update + lifecycle). */
export const upsertMasterTemplateBodySchema = createMasterTemplateBodySchema
  .extend({
    templateCode: z.string().trim().min(1).optional(),
  })
  .passthrough();

export type UpsertMasterTemplateBody = z.infer<typeof upsertMasterTemplateBodySchema>;

/** Query params for GET /templates and GET /templates/master (OpenAPI). */
export const listMasterTemplatesQuerySchema = z.object({
  templateLevel: templateLevelZ.optional(),
  organizationId: z.string().trim().min(1).optional(),
  category: optionalListFilterZ,
  condition: optionalListFilterZ,
  conditionCode: optionalListFilterZ,
  country: optionalListFilterZ,
  status: optionalListFilterZ,
  shareScope: shareScopeInputZ.optional(),
  templateType: optionalListFilterZ,
  language: optionalListFilterZ,
  specialty: optionalListFilterZ,
  templateCode: optionalListFilterZ,
  templateName: optionalListFilterZ,
  /** Filter by `isActive` (true = active templates, false = inactive including published with active false). */
  active: optionalActiveQueryZ,
  /** Opaque cursor from a previous list response (`nextPaginationKey`). Page size is fixed at 20. */
  nextPaginationKey: z.string().trim().min(1).optional(),
  /** @deprecated Prefer nextPaginationKey */
  nextToken: z.string().trim().min(1).optional(),
});

export type ListMasterTemplatesQuery = z.infer<typeof listMasterTemplatesQuerySchema>;

export const getMasterVersionsQuerySchema = z.object({
  templateLevel: templateLevelZ.optional(),
  organizationId: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  resolve: z.enum(['ACTIVE', 'LATEST_PUBLISHED', 'LATEST_ANY']).optional(),
  status: z.string().trim().min(1).optional(),
  nextPaginationKey: z.string().trim().min(1).optional(),
  /** @deprecated Prefer nextPaginationKey */
  nextToken: z.string().trim().min(1).optional(),
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

const metadataTypeCodeZ = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Z][A-Za-z0-9]*$/, 'Must match ^[A-Z][A-Za-z0-9]*$');

/** POST `/template-configs/meta` body. */
export const postTemplateConfigMetaBodySchema = z.object({
  metadataTypeCodes: z
    .array(metadataTypeCodeZ)
    .min(1, 'Must contain at least one metadataTypeCode')
    .transform((codes) => {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const code of codes) {
        if (!seen.has(code)) {
          seen.add(code);
          deduped.push(code);
        }
      }
      return deduped;
    }),
});

export const createTemplateConfigBodySchema = z
  .object({
    id: z.string().trim().min(1),
    configType: z.enum(['TEMPLATE', 'ORG']).optional(),
    templateType: z.string().trim().min(1).optional(),
    configKey: z.string().trim().min(1).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
    version: z.number().int().positive().optional(),
  })
  .passthrough();

export const updateTemplateConfigBodySchema = z
  .object({
    id: z.string().trim().min(1),
  })
  .passthrough();

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
  return withResolvedPaginationKey(getMasterVersionsQuerySchema.parse(params));
}

export const cloneTemplateBodySchema = z.object({
  newTemplateName: z.string().trim().min(1).max(150).optional(),
});

export type CloneTemplateBody = z.infer<typeof cloneTemplateBodySchema>;

export const orgTemplatePathSchema = z.object({
  organizationId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
});

/** GET/PUT /templates/org/{templateId}/{orgId} — master template id + organization id. */
export const orgTemplateRulesPathSchema = z.object({
  templateId: z.string().trim().min(1),
  orgId: z.string().trim().min(1),
});

type PartialTemplateFieldRuleInput = PartialTemplateFieldRule;

const partialTemplateFieldRuleSchema: z.ZodType<PartialTemplateFieldRuleInput> = z.lazy(() =>
  z
    .object({
      enable: z.boolean().optional(),
      orgedit: z.boolean().optional(),
      add: z.boolean().optional(),
      defaultedit: z.boolean().optional(),
      delete: z.boolean().optional(),
      metadataMode: z.string().trim().min(1).optional(),
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
      rules: z.record(z.string().trim().min(1), partialTemplateFieldRuleSchema).optional(),
    })
    .strict()
    .superRefine((rule, ctx) => {
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'min cannot exceed max',
        });
      }
    }),
);

export const updateOrgTemplateRulesBodySchema = z
  .object({
    rules: z.record(z.string().trim().min(1), partialTemplateFieldRuleSchema).optional(),
    fieldValues: fieldValuesSchema.optional(),
    status: orgTemplateLifecycleStatusZ.optional(),
    active: z.boolean().optional(),
    adopt: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const hasRules = data.rules !== undefined && Object.keys(data.rules).length > 0;
    const hasFieldValues =
      data.fieldValues !== undefined && Object.keys(data.fieldValues).length > 0;
    const hasStatus = data.status !== undefined;
    const hasActive = data.active !== undefined;
    const hasAdopt = data.adopt === true;
    if (!hasRules && !hasFieldValues && !hasStatus && !hasActive && !hasAdopt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rules, fieldValues, status, active, or adopt must be provided',
        path: ['rules'],
      });
    }
  });

export type UpdateOrgTemplateRulesBody = z.infer<typeof updateOrgTemplateRulesBodySchema>;

const orgDerivedStatusZ = orgTemplateLifecycleStatusZ;

/** POST /templates/org-derived */
export const orgDerivedCreateBodySchema = z.object({
  organizationId: z.string().trim().min(1),
  organizationMeta: organizationMetaSchema.optional(),
  sourceOrgTemplateId: z.string().trim().min(1),
  newTemplateName: z.string().trim().min(1).max(150),
  sourceVersionId: z.string().trim().min(1).optional(),
  /** Optional — defaults to `true` when omitted. */
  templateEnabled: z.boolean().optional(),
});

export type OrgDerivedCreateBody = z.infer<typeof orgDerivedCreateBodySchema>;

/** PUT /templates/org-derived/{orgTemplateId} */
export const orgDerivedPathSchema = z.object({
  orgTemplateId: z.string().trim().min(1),
});

export const orgDerivedUpdateBodySchema = z
  .object({
    rules: z.record(z.string().trim().min(1), partialTemplateFieldRuleSchema).optional(),
    fieldValues: fieldValuesSchema.optional(),
    templateEnabled: z.boolean().optional(),
    status: orgDerivedStatusZ.optional(),
    active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const hasRules = data.rules !== undefined && Object.keys(data.rules).length > 0;
    const hasFieldValues =
      data.fieldValues !== undefined && Object.keys(data.fieldValues).length > 0;
    const hasEnable = data.templateEnabled !== undefined;
    const hasStatus = data.status !== undefined;
    const hasActive = data.active !== undefined;
    if (!hasRules && !hasFieldValues && !hasEnable && !hasStatus && !hasActive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rules, fieldValues, templateEnabled, status, or active must be provided',
        path: ['rules'],
      });
    }
  });

export type OrgDerivedUpdateBody = z.infer<typeof orgDerivedUpdateBodySchema>;

/** POST /templates/org-derived/{orgTemplateId}/adopt */
export const orgDerivedAdoptBodySchema = z.object({
  confirm: z.boolean().optional().default(true),
  preserveLocalOverrides: z.boolean().optional(),
});

export type OrgDerivedAdoptBody = z.infer<typeof orgDerivedAdoptBodySchema>;

/** POST /templates with templateLevel=ORG_CARE_PLAN */
export const orgCarePlanCreateBodySchema = z
  .object({
    templateLevel: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
      z.literal('ORG_CARE_PLAN'),
    ),
    templateType: z.string().trim().min(1),
    organizationId: z.string().trim().min(1),
    orgDerivedTemplateId: z.string().trim().min(1),
    organizationMeta: organizationMetaSchema.optional(),
    templateName: z.string().trim().min(1).max(150).optional(),
    TEMPLATE_NAME: z.string().trim().min(1).max(150).optional(),
    status: orgDerivedStatusZ.optional(),
    active: z.boolean().optional(),
    templateEnabled: z.boolean().optional(),
    fieldValues: fieldValuesSchema.optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const templateType = data.templateType.trim().toUpperCase().replace(/\s+/g, '_');
    if (templateType !== 'CARE_PLAN') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'templateType must be CARE_PLAN when templateLevel is ORG_CARE_PLAN',
        path: ['templateType'],
      });
    }
    const name = data.templateName?.trim() || data.TEMPLATE_NAME?.trim();
    if (!name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'templateName or TEMPLATE_NAME is required',
        path: ['templateName'],
      });
    }
  });

export type OrgCarePlanCreateBody = z.infer<typeof orgCarePlanCreateBodySchema>;

export const orgClonePathSchema = z.object({
  organizationId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
});

export const listOrgTemplatesQuerySchema = z.object({
  templateLevel: templateLevelZ.optional(),
  organizationId: z.string().trim().min(1).optional(),
  /** Same as organizationId — id from organizationMeta returned by this endpoint. */
  organizationMetaId: z.string().trim().min(1).optional(),
  /** When templateLevel=ORG_DERIVED or ORG_CARE_PLAN — return one variant with full fieldValues + rules. */
  orgTemplateId: z.string().trim().min(1).optional(),
  organizationName: z.string().trim().min(1).optional(),
  organizationDescription: z.string().trim().optional(),
  categoryCode: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  condition: z.string().trim().min(1).optional(),
  conditionCode: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  templateType: z.string().trim().min(1).optional(),
  templateName: z.string().trim().min(1).optional(),
  templateId: z.string().trim().min(1).optional(),
  templateEnabled: optionalActiveQueryZ,
  country: z.string().trim().min(1).optional(),
  specialty: z.string().trim().min(1).optional(),
  nextPaginationKey: z.string().trim().min(1).optional(),
  /** @deprecated Prefer nextPaginationKey */
  nextToken: z.string().trim().min(1).optional(),
});

export type ListOrgTemplatesQuery = z.infer<typeof listOrgTemplatesQuerySchema>;

export const orgVersionStatusQuerySchema = z
  .object({
    organizationId: z.string().trim().min(1).optional(),
    templateId: z.string().trim().min(1).optional(),
    orgTemplateId: z.string().trim().min(1).optional(),
    organizationName: z.string().trim().min(1).optional(),
    organizationDescription: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const hasTemplateId = !!data.templateId?.trim();
    const hasOrgTemplateId = !!data.orgTemplateId?.trim();
    if (hasTemplateId === hasOrgTemplateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one of templateId or orgTemplateId is required',
        path: ['templateId'],
      });
    }
  });

export type OrgVersionStatusQuery = z.infer<typeof orgVersionStatusQuerySchema>;

export function parseOrgVersionStatusQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): OrgVersionStatusQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      const single = Array.isArray(value) ? value[0] : value;
      if (isAbsentQueryValue(single)) continue;
      params[key] = single;
    }
  }
  return orgVersionStatusQuerySchema.parse(params);
}

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

function isAbsentQueryValue(value: string | undefined): boolean {
  if (value === undefined) return true;
  const v = value.trim().toLowerCase();
  return v === '' || v === 'null' || v === 'undefined' || v === 'all';
}

/** Prefer `nextPaginationKey`; accept legacy `nextToken`. */
export function resolveListPaginationKey(query: {
  nextPaginationKey?: string;
  nextToken?: string;
}): string | undefined {
  const key = query.nextPaginationKey?.trim();
  if (key) return key;
  const legacy = query.nextToken?.trim();
  return legacy || undefined;
}

function withResolvedPaginationKey<T extends { nextPaginationKey?: string; nextToken?: string }>(
  query: T,
): T & { nextToken?: string } {
  const cursor = resolveListPaginationKey(query);
  return { ...query, ...(cursor ? { nextToken: cursor } : {}) };
}

export function parseListOrgTemplatesQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): ListOrgTemplatesQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      const single = Array.isArray(value) ? value[0] : value;
      if (isAbsentQueryValue(single)) continue;
      params[key] = single;
    }
  }
  return withResolvedPaginationKey(listOrgTemplatesQuerySchema.parse(params));
}

export function parseListMasterTemplatesQuery(
  raw: Record<string, string | string[] | undefined> | null | undefined,
): ListMasterTemplatesQuery {
  const params: Record<string, string | undefined> = {};
  if (raw) {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === null) continue;
      const single = Array.isArray(value) ? value[0] : value;
      if (isAbsentQueryValue(single)) continue;
      params[key] = single;
    }
  }
  return withResolvedPaginationKey(listMasterTemplatesQuerySchema.parse(params));
}
