import {
  assertRegistryEntityKind,
  assertRegistryPathCodesForKind,
  extractRegistryEntityPath,
  lifecycleStatusesFromQuery,
  type Status,
} from '@api-hub/metadata';
import { z } from 'zod';

export const getMetadataSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const extracted = extractRegistryEntityPath(q, p);
    const lifecycleStatuses = lifecycleStatusesFromQuery(q.status) as Status[];
    return { ...extracted, lifecycleStatuses };
  })
  .superRefine((data) => {
    const kind = assertRegistryEntityKind(data.entityTypeRaw);
    assertRegistryPathCodesForKind(kind, data.metadataTypeCode, data.valueCode, 'get');
  })
  .transform((data) => {
    const kind = data.kind;
    if (kind === 'type') {
      return {
        entityType: 'type' as const,
        metadataTypeCode: data.metadataTypeCode,
        lifecycleStatuses: data.lifecycleStatuses,
      };
    }
    return {
      entityType: 'value' as const,
      metadataTypeCode: data.metadataTypeCode,
      valueCode: data.valueCode,
      lifecycleStatuses: data.lifecycleStatuses,
    };
  });

export type GetMetadataInput = z.infer<typeof getMetadataSchema>;
