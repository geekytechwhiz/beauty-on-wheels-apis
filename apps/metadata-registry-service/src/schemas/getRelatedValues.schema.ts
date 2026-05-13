import { z } from 'zod';

import { normalizeRelationListQueryParams } from './relationListQuery.shared';

/**
 * Related values list: same resolution as the former handler; `fromType` / `fromValue`
 * have no `*Code` aliases (only `toType` has `toMetadataTypeCode`).
 */
export const getRelatedValuesSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const fromType = q.fromType ?? p.fromType ?? '';
    const fromValue = q.fromValue ?? p.fromValue ?? '';
    const relationType = q.relationType ?? p.relationType;
    const toType = q.toType ?? q.toMetadataTypeCode ?? p.toType ?? p.toMetadataTypeCode;
    return { fromType, fromValue, relationType, toType };
  })
  .transform((raw) => normalizeRelationListQueryParams(raw));

export type GetRelatedValuesInput = z.infer<typeof getRelatedValuesSchema>;
