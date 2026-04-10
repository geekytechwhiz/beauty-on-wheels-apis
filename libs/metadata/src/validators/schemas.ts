import { z } from 'zod';
import { GLOBAL_DIMENSION } from '../domain/constants';

const contextSchema = z.object({
  module: z.string().min(1),
  category: z.string().min(1),
  condition: z.string().min(1),
  country: z.string().min(1),
});

export const createMetadataTypeSchema = z.object({
  metadataTypeCode: z.string().min(1).max(256),
  displayName: z.string().min(1),
  description: z.string().optional(),
  valueDataType: z.enum(['Enum', 'Numeric', 'Boolean', 'Text']),
  multiSelectAllowed: z.boolean(),
  applicableModules: z.array(z.string()).default([]),
  attributeSchema: z.record(z.string(), z.unknown()).optional(),
  createdBy: z.string().optional(),
});

export const updateMetadataTypeSchema = z.object({
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  valueDataType: z.enum(['Enum', 'Numeric', 'Boolean', 'Text']).optional(),
  multiSelectAllowed: z.boolean().optional(),
  applicableModules: z.array(z.string()).optional(),
  attributeSchema: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  updatedBy: z.string().optional(),
});

export const createMetadataValueSchema = z.object({
  metadataValueCode: z.string().min(1).max(256),
  label: z.string().min(1),
  description: z.string().optional(),
  isGlobal: z.boolean(),
  applicableModules: z.array(z.string()).default([]),
  applicableCategories: z.array(z.string()).default([]),
  applicableConditions: z.array(z.string()).default([]),
  applicableCountries: z.array(z.string()).default([]),
  valueAttributes: z.record(z.string(), z.unknown()).default({}),
  createdBy: z.string().optional(),
});

export const updateMetadataValueSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  isGlobal: z.boolean().optional(),
  applicableModules: z.array(z.string()).optional(),
  applicableCategories: z.array(z.string()).optional(),
  applicableConditions: z.array(z.string()).optional(),
  applicableCountries: z.array(z.string()).optional(),
  valueAttributes: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  updatedBy: z.string().optional(),
});

export const validateMetadataValueBodySchema = z.object({
  metadataTypeCode: z.string().min(1),
  metadataValueCode: z.string().min(1),
  context: contextSchema,
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
  includeInactive: z.coerce.boolean().optional().default(false),
});

export const listMetadataTypesQuerySchema = paginationSchema;

export const listMetadataValuesQuerySchema = paginationSchema.extend({
  module: z.string().optional().default(GLOBAL_DIMENSION),
  category: z.string().optional().default(GLOBAL_DIMENSION),
  condition: z.string().optional().default(GLOBAL_DIMENSION),
  country: z.string().optional().default(GLOBAL_DIMENSION),
});

export type CreateMetadataTypeInput = z.infer<typeof createMetadataTypeSchema>;
export type UpdateMetadataTypeInput = z.infer<typeof updateMetadataTypeSchema>;
export type CreateMetadataValueInput = z.infer<typeof createMetadataValueSchema>;
export type UpdateMetadataValueInput = z.infer<typeof updateMetadataValueSchema>;
export type ListMetadataTypesQuery = z.infer<typeof listMetadataTypesQuerySchema>;
export type ListMetadataValuesQuery = z.infer<typeof listMetadataValuesQuerySchema>;
