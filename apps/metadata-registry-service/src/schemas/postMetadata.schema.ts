import { STATUS, ValidationError } from '@api-hub/metadata';
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
    if (!data.entityTypeRaw) {
      throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
    }
    if (data.kind === 'type') {
      const code = data.body?.metadataTypeCode;
      if (code === undefined || code === null || typeof code !== 'string' || code.trim() === '') {
        throw new ValidationError('metadataTypeCode is required', [
          {
            field: 'metadataTypeCode',
            message:
              code !== undefined && code !== null && typeof code !== 'string' ? 'Must be a string' : 'Required',
          },
        ]);
      }
      return;
    }
    if (data.kind === 'value') {
      const raw = data.body;
      const typeCodeRaw = raw.metadataTypeCode;
      if (
        typeCodeRaw === undefined ||
        typeCodeRaw === null ||
        typeof typeCodeRaw !== 'string' ||
        typeCodeRaw.trim() === ''
      ) {
        throw new ValidationError('metadataTypeCode is required', [
          {
            field: 'metadataTypeCode',
            message:
              typeCodeRaw !== undefined && typeCodeRaw !== null && typeof typeCodeRaw !== 'string'
                ? 'Must be a string'
                : 'Required',
          },
        ]);
      }
      refinePostMetadataValueBody(raw);
      return;
    }
    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  })
  .transform((data) => {
    if (data.kind === 'type') {
      return { entityType: 'type' as const, userId: data.userId, body: data.body };
    }
    return { entityType: 'value' as const, userId: data.userId, body: data.body };
  });

export type PostMetadataInput = z.infer<typeof postMetadataSchema>;
