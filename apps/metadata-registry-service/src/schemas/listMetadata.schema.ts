import { STATUS, type Status } from '@api-hub/metadata';
import { z } from 'zod';
/**
 * Utility: CSV → string[]
 */
const csvToArray = z
  .string()
  .transform((val) =>
    val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .optional();

/**
 * Entity type
 */
const entityTypeSchema = z.enum(['type', 'value']);

/**
 * Status handling (default ACTIVE)
 */
const statusSchema: z.ZodType<Status> = z
  .string()
  .optional()
  .transform((val) => (val ? val.trim().toUpperCase() : STATUS.ACTIVE))
  .pipe(z.enum([STATUS.ACTIVE, STATUS.INACTIVE]));

/**
 * Base request extraction
 */
export const listMetadataSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};

    const entityTypeRaw = q.entityType ?? p.entityType ?? '';
    const entityType = entityTypeSchema.parse(entityTypeRaw.trim().toLowerCase());

    const metadataTypeCode = (q.metadataTypeCode ?? p.metadataTypeCode ?? '').trim();

    return {
      entityType,

      // Common
      metadataTypeCode,

      // TYPE filters
      module: q.module,
      valueDataType: q.valueDataType ?? q.datatype,
      statusMode: q.statusMode, // pass through to service

      // VALUE filters
      status: statusSchema.parse(q.status),

      applicableModules: csvToArray.parse(q.applicableModules),
      applicableCategories: csvToArray.parse(q.applicableCategories),
      applicableConditions: csvToArray.parse(q.applicableConditions),
      applicableCountries: csvToArray.parse(q.applicableCountries),
      applicableLanguages: csvToArray.parse(q.applicableLanguages),

      search: q.search,
    };
  })
  .superRefine((data, ctx) => {
    // ❗ entityType specific validations

    if (data.entityType === 'value') {
      if (!data.metadataTypeCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metadataTypeCode'],
          message: 'metadataTypeCode is required',
        });
      }

      if (data.search) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['search'],
          message: 'search is not supported; use structured filters',
        });
      }
    }
  });

export type ListMetadataInput = z.infer<typeof listMetadataSchema>;
