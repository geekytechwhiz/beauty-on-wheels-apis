import { z } from 'zod';

import { normalizeRelatedValuesQueryParams } from './relationListQuery.shared';

/**
 * Related values list: resolves `fromType` / `fromValue` from query or path params.
 * `fromValue` supports a single value (backward compatible), repeated query params
 * (`fromValue=IN&fromValue=US` via `multiValueQueryStringParameters`), or a
 * comma-separated value (`fromValue=IN,US`). Only `toType` has the
 * `toMetadataTypeCode` alias.
 */
export const getRelatedValuesSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
    event: z
      .object({
        multiValueQueryStringParameters: z
          .record(z.string(), z.array(z.string()).nullish())
          .nullish(),
      })
      .passthrough()
      .optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const multiFromValue = req.event?.multiValueQueryStringParameters?.fromValue;
    const fromType = q.fromType ?? p.fromType ?? '';
    const rawFromValues: string | string[] =
      Array.isArray(multiFromValue) && multiFromValue.length > 0
        ? multiFromValue
        : q.fromValue ?? p.fromValue ?? '';
    const relationType = q.relationType ?? p.relationType;
    const toType = q.toType ?? q.toMetadataTypeCode ?? p.toType ?? p.toMetadataTypeCode;
    return { fromType, rawFromValues, relationType, toType };
  })
  .transform((raw) => normalizeRelatedValuesQueryParams(raw));

export type GetRelatedValuesInput = z.infer<typeof getRelatedValuesSchema>;
