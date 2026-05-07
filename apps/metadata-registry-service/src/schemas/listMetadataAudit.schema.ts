import {
  assertRegistryEntityKind,
  assertRegistryPathCodesForKind,
  extractRegistryEntityPath,
} from '@api-hub/metadata';
import { z } from 'zod';

export const listMetadataAuditSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    return extractRegistryEntityPath(q, p);
  })
  .superRefine((data) => {
    const kind = assertRegistryEntityKind(data.entityTypeRaw);
    assertRegistryPathCodesForKind(kind, data.metadataTypeCode, data.valueCode, 'auditLike');
  })
  .transform((data) => {
    if (data.kind === 'type') {
      return { entityType: 'type' as const, metadataTypeCode: data.metadataTypeCode };
    }
    return {
      entityType: 'value' as const,
      metadataTypeCode: data.metadataTypeCode,
      valueCode: data.valueCode,
    };
  });

export type ListMetadataAuditInput = z.infer<typeof listMetadataAuditSchema>;
