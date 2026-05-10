import {
  ValidationError,
  assertRegistryEntityKind,
  assertStatusEnum,
  parseQueryIncludeInactive,
  type Status,
} from '@api-hub/metadata';
import { z } from 'zod';

/**
 * CSV string -> trimmed, non-empty string[]. Returns undefined when the input is missing.
 */
function parseCsvToArray(val: string | undefined): string[] | undefined {
  if (val === undefined) return undefined;
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Optional list `status` query param. Empty/undefined -> undefined (service defaults to
 * ACTIVE-only via `resolveStatusMode`). Any other value must be ACTIVE or INACTIVE,
 * otherwise we surface a 400 ValidationError consistent with the rest of the registry routes.
 */
function normalizeListStatus(raw: string | undefined): Status | undefined {
  if (raw === undefined || raw === '') return undefined;
  const s = String(raw).trim().toUpperCase();
  assertStatusEnum(s);
  return s;
}

function parseOptionalLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const trimmed = String(raw).trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new ValidationError('limit must be a positive integer from 1 to 100', [
      { field: 'limit', message: 'Must be an integer between 1 and 100' },
    ]);
  }
  return n;
}

function parseOptionalNextPaginationKey(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const s = String(raw).trim();
  return s === '' ? undefined : s;
}

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

    return {
      entityTypeRaw: (q.entityType ?? p.entityType ?? '').trim().toLowerCase(),

      metadataTypeCode: (q.metadataTypeCode ?? p.metadataTypeCode ?? '').trim(),

      module: q.module,
      valueDataType: q.valueDataType ?? q.datatype,
      rawStatus: q.status,
      includeInactive: parseQueryIncludeInactive(q as Record<string, string | undefined>),

      applicableModules: q.applicableModules,
      applicableCategories: q.applicableCategories,
      applicableConditions: q.applicableConditions,
      applicableCountries: q.applicableCountries,
      applicableLanguages: q.applicableLanguages,

      search: q.search,

      rawLimit: q.limit,
      rawNextPaginationKey: q.nextPaginationKey,
    };
  })
  .superRefine((data) => {
    const kind = assertRegistryEntityKind(data.entityTypeRaw);

    if (kind === 'value') {
      if (!data.metadataTypeCode) {
        throw new ValidationError('metadataTypeCode is required', [
          { field: 'metadataTypeCode', message: 'Required' },
        ]);
      }

      if (data.search) {
        throw new ValidationError('search is not supported; use structured filters', [
          { field: 'search', message: 'search is not supported; use structured filters' },
        ]);
      }
    }
  })
  .transform((data) => ({
    entityType: (data.entityTypeRaw === 'value' ? 'value' : 'type') as 'type' | 'value',

    metadataTypeCode: data.metadataTypeCode,

    module: data.module,
    valueDataType: data.valueDataType,
    status: normalizeListStatus(data.rawStatus),
    includeInactive: data.includeInactive,

    applicableModules: parseCsvToArray(data.applicableModules),
    applicableCategories: parseCsvToArray(data.applicableCategories),
    applicableConditions: parseCsvToArray(data.applicableConditions),
    applicableCountries: parseCsvToArray(data.applicableCountries),
    applicableLanguages: parseCsvToArray(data.applicableLanguages),

    search: data.search,

    limit: parseOptionalLimit(data.rawLimit),
    nextPaginationKey: parseOptionalNextPaginationKey(data.rawNextPaginationKey),
  }));

export type RegistryListMetadataRequest = z.infer<typeof listMetadataSchema>;
