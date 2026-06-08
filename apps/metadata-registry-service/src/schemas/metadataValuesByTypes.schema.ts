import { METADATA_TYPE_CODE_PATTERN, ValidationError } from '@api-hub/metadata';
import { z } from 'zod';

/**
 * POST `/metadata/values/by-types`.
 *
 * Body shape: `{ "metadataTypeCodes": ["Country", "Language", ...] }`.
 * The host middleware parses JSON (an unparseable / missing body arrives as `undefined`), so the
 * schema treats a missing or non-object body as a 400. Codes are trimmed, de-duplicated (first
 * occurrence wins, order preserved) and validated against the shared `MetadataTypeCode` pattern.
 */
export const metadataValuesByTypesSchema = z
  .object({
    body: z.unknown().optional(),
  })
  .transform((req) => ({ body: req.body }))
  .superRefine((data) => {
    const body = data.body;
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Request body is required', [
        { field: 'body', message: 'A JSON object body is required' },
      ]);
    }

    const codes = (body as Record<string, unknown>).metadataTypeCodes;
    if (!Array.isArray(codes)) {
      throw new ValidationError('metadataTypeCodes must be an array', [
        { field: 'metadataTypeCodes', message: 'Required; must be a non-empty array of strings' },
      ]);
    }
    if (codes.length === 0) {
      throw new ValidationError('metadataTypeCodes must not be empty', [
        { field: 'metadataTypeCodes', message: 'Must contain at least one metadataTypeCode' },
      ]);
    }

    codes.forEach((code, i) => {
      if (typeof code !== 'string' || code.trim() === '') {
        throw new ValidationError('Each metadataTypeCode must be a non-empty string', [
          { field: `metadataTypeCodes[${i}]`, message: 'Must be a non-empty string' },
        ]);
      }
      if (!METADATA_TYPE_CODE_PATTERN.test(code.trim())) {
        throw new ValidationError(`Invalid metadataTypeCode: ${code.trim()}`, [
          { field: `metadataTypeCodes[${i}]`, message: 'Must match ^[A-Z][A-Za-z0-9]*$' },
        ]);
      }
    });
  })
  .transform((data) => {
    const codes = (data.body as Record<string, unknown>).metadataTypeCodes as string[];
    const seen = new Set<string>();
    const metadataTypeCodes: string[] = [];
    for (const raw of codes) {
      const trimmed = raw.trim();
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        metadataTypeCodes.push(trimmed);
      }
    }
    return { metadataTypeCodes };
  });

export type MetadataValuesByTypesInput = z.infer<typeof metadataValuesByTypesSchema>;
