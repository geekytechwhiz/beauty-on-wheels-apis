import { z } from 'zod';

import { normalizeRelationListQueryParams } from './relationListQuery.shared';

/**
 * GET relations list: mirrors prior handler resolution (params + pathParameters), including
 * `fromTypeCode` / `fromValueCode` aliases on query or path.
 */
export const getRelationsSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const fromType = q.fromType ?? q.fromTypeCode ?? p.fromType ?? p.fromTypeCode ?? '';
    const fromValue = q.fromValue ?? q.fromValueCode ?? p.fromValue ?? p.fromValueCode ?? '';
    const relationType = q.relationType ?? p.relationType;
    const toType = q.toType ?? q.toMetadataTypeCode ?? p.toType ?? p.toMetadataTypeCode;
    return { fromType, fromValue, relationType, toType };
  })
  .transform((raw) => normalizeRelationListQueryParams(raw));

export type GetRelationsInput = z.infer<typeof getRelationsSchema>;
