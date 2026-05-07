import { STATUS, ValidationError, assertMetadataTypeCodePresentOnBody, assertRegistryEntityKind } from '@api-hub/metadata';
import { z } from 'zod';

const APPLICABILITY_KEYS = [
  'applicableModules',
  'applicableCategories',
  'applicableConditions',
  'applicableCountries',
  'applicableLanguages',
] as const;

function refinePostMetadataValueBody(body: Record<string, unknown>): void {
  const details: { field: string; message: string }[] = [];

  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

  if (!has('label') || String(body.label).trim() === '') {
    details.push({
      field: 'label',
      message: has('label') ? 'Must be a non-empty string' : 'Required',
    });
  }

  if (!has('isGlobal') || typeof body.isGlobal !== 'boolean') {
    details.push({
      field: 'isGlobal',
      message: has('isGlobal') ? 'Must be a boolean' : 'Required',
    });
  }

  if (!has('status')) {
    details.push({ field: 'status', message: 'Required' });
  } else {
    const s = String(body.status).trim().toUpperCase();
    if (s !== STATUS.ACTIVE && s !== STATUS.INACTIVE) {
      details.push({ field: 'status', message: 'Must be ACTIVE or INACTIVE' });
    }
  }

  for (const k of APPLICABILITY_KEYS) {
    if (has(k) && !Array.isArray(body[k])) {
      details.push({ field: k, message: 'Must be an array' });
    }
  }

  const valueCode = (body.valueCode ?? body.metadataValueCode) as string | undefined;
  if (valueCode === undefined || valueCode === null || String(valueCode).trim() === '') {
    details.push({ field: 'metadataValueCode', message: 'valueCode or metadataValueCode is required' });
  }

  if (details.length) {
    throw new ValidationError('metadata value payload is missing or invalid required fields', details);
  }
}

export const postMetadataSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
    body: z.unknown().optional(),
    context: z
      .object({
        userContext: z.object({ userId: z.string().optional() }).optional(),
      })
      .optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const entityTypeRaw = (q.entityType ?? p.entityType ?? '').trim();
    const kind = entityTypeRaw.toLowerCase();
    const userId = req.context?.userContext?.userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    return { entityTypeRaw, kind, userId, body };
  })
  .superRefine((data) => {
    const kind = assertRegistryEntityKind(data.entityTypeRaw);
    if (kind === 'type') {
      assertMetadataTypeCodePresentOnBody(data.body as Record<string, unknown>);
      return;
    }
    assertMetadataTypeCodePresentOnBody(data.body as Record<string, unknown>);
    refinePostMetadataValueBody(data.body as Record<string, unknown>);
  })
  .transform((data) => {
    if (data.kind === 'type') {
      return { entityType: 'type' as const, userId: data.userId, body: data.body };
    }
    return { entityType: 'value' as const, userId: data.userId, body: data.body };
  });

export type PostMetadataInput = z.infer<typeof postMetadataSchema>;
