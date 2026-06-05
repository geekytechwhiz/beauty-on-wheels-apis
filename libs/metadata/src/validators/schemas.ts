import { z } from 'zod';

import { METADATA_TYPE_CODE_PATTERN, METADATA_VALUE_CODE_PATTERN } from './code-patterns';

const contextSchema = z.object({
  module: z.string().min(1),
  category: z.string().min(1),
  condition: z.string().min(1),
  country: z.string().min(1),
});

/** Create metadata type — required fields match product definition (displayName max 100, status ACTIVE|INACTIVE). */
export const createMetadataTypeSchema = z.object({
  metadataTypeCode: z.string().regex(METADATA_TYPE_CODE_PATTERN, 'Invalid metadataTypeCode'),
  displayName: z.string().min(1).max(100),
  description: z.string().optional(),
  valueDataType: z.enum(['Enum', 'Numeric', 'Boolean', 'Text']),
  multiSelectAllowed: z.boolean(),
  applicableModules: z.array(z.string()).optional(),
  attributeSchema: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  supportsRelations: z.boolean().optional(),
  relationFieldLabel: z.string().max(150).nullable().optional(),
  targetMetadataTypeCode: z.string().regex(METADATA_TYPE_CODE_PATTERN).nullable().optional(),
  selectionMode: z.enum(['SINGLE', 'MULTI']).nullable().optional(),
  relationRequired: z.boolean().nullable().optional(),
  relationType: z
    .enum(['PARENT_CHILD', 'VALID_IN', 'SUPPORTED_BY', 'BELONGS_TO_CATEGORY'])
    .nullable()
    .optional(),
  createdBy: z.string().optional(),
  lastModifiedBy: z.string().optional(),
});

export const patchMetadataStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  lastModifiedBy: z.string().optional(),
});

const applicabilityObjectSchema = z.object({
  module: z.array(z.string()),
  category: z.array(z.string()),
  condition: z.array(z.string()),
  country: z.array(z.string()),
  language: z.array(z.string()).optional(),
});

/** Aligns with POST /metadata-types/{metadataTypeCode}/values body (MetadataValueInput). */
export const createMetadataValueSchema = z
  .object({
    valueCode: z.string().regex(METADATA_VALUE_CODE_PATTERN, 'Invalid valueCode').optional(),
    metadataValueCode: z.string().regex(METADATA_VALUE_CODE_PATTERN, 'Invalid metadataValueCode').optional(),
    label: z.string().min(1).max(150),
    description: z.string().max(2000).optional(),
    sortOrder: z.number().int().min(0).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    isGlobal: z.boolean(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    valueAttributes: z.record(z.string(), z.unknown()).optional(),
    applicability: applicabilityObjectSchema.optional(),
    applicableModules: z.array(z.string()).optional(),
    applicableCategories: z.array(z.string()).optional(),
    applicableConditions: z.array(z.string()).optional(),
    applicableCountries: z.array(z.string()).optional(),
    applicableLanguages: z.array(z.string()).optional(),
    relationships: z
      .array(
        z.object({
          targetMetadataValueCode: z.string().regex(METADATA_VALUE_CODE_PATTERN, 'Invalid targetMetadataValueCode'),
        }),
      )
      .optional(),
  })
  .refine((b) => !!(b.valueCode || b.metadataValueCode), { message: 'valueCode or metadataValueCode is required' });

export const validateMetadataValueBodySchema = z.object({
  metadataTypeCode: z.string().min(1),
  metadataValueCode: z.string().min(1),
  context: contextSchema,
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
});

export const listMetadataTypesQuerySchema = paginationSchema;

export const listMetadataValuesQuerySchema = paginationSchema.extend({
  module: z.string().optional(),
  category: z.string().optional(),
  condition: z.string().optional(),
  country: z.string().optional(),
  language: z.string().optional(),
});

/** POST body: which applicability dimension to collect distinct values for. */
export const applicabilityContextFilterBodySchema = z.object({
  dimension: z.enum(['module', 'category', 'condition', 'country', 'language'], {
    message: 'dimension must be module, category, condition, country, or language',
  }),
});

export const listMetadataAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
});

export const listMetadataTypeAuditParamsSchema = z.object({
  metadataTypeCode: z.string().regex(METADATA_TYPE_CODE_PATTERN, 'Invalid metadataTypeCode'),
});

export const listMetadataValueAuditParamsSchema = z.object({
  metadataTypeCode: z.string().regex(METADATA_TYPE_CODE_PATTERN, 'Invalid metadataTypeCode'),
  metadataValueCode: z.string().regex(METADATA_VALUE_CODE_PATTERN, 'Invalid metadataValueCode'),
});

/** Path params for routes under /metadata-types/{metadataTypeCode}/… */
export const metadataTypePathParamsSchema = listMetadataTypeAuditParamsSchema;

/** Path params for routes under …/values/{metadataValueCode}/… */
export const metadataValuePathParamsSchema = listMetadataValueAuditParamsSchema;

export type CreateMetadataTypeInput = z.infer<typeof createMetadataTypeSchema>;
export type CreateMetadataValueInput = z.infer<typeof createMetadataValueSchema>;
export type ListMetadataTypesQuery = z.infer<typeof listMetadataTypesQuerySchema>;
export type ListMetadataValuesQuery = z.infer<typeof listMetadataValuesQuerySchema>;
export type ListMetadataAuditQuery = z.infer<typeof listMetadataAuditQuerySchema>;
export type ListMetadataTypeAuditParams = z.infer<typeof listMetadataTypeAuditParamsSchema>;
export type ListMetadataValueAuditParams = z.infer<typeof listMetadataValueAuditParamsSchema>;
export type MetadataTypePathParams = z.infer<typeof metadataTypePathParamsSchema>;
export type MetadataValuePathParams = z.infer<typeof metadataValuePathParamsSchema>;
export type ApplicabilityContextFilterBody = z.infer<typeof applicabilityContextFilterBodySchema>;
