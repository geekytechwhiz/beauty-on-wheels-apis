import { STATUS, ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import type { MetadataValueInput } from '@api-hub/metadata';
import {
  flattenMetadataValueForApi,
  getValue,
  normalizeMetadataValueInput,
  upsertMetadataValue,
} from '../services/metadataService';

function codeFromReq(req: { params?: Record<string, string>; pathParameters?: Record<string, string> }): string {
  return req.params?.metadataTypeCode ?? req.pathParameters?.metadataTypeCode ?? '';
}

const APPLICABILITY_KEYS = [
  'applicableModules',
  'applicableCategories',
  'applicableConditions',
  'applicableCountries',
] as const;

/**
 * Enforces required fields on every POST (create and update):
 * `metadataTypeCode` and `valueCode`/`metadataValueCode`, `label`, `isGlobal`, `status`.
 * `applicableModules` / `applicableCategories` / `applicableConditions` / `applicableCountries`
 * are optional; when present they must be arrays (empty arrays allowed).
 */
function assertPostMetadataValueRequiredBody(body: Record<string, unknown>): void {
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

export const main = withLambdaHandler(
  async (req: {
    params?: Record<string, string>;
    pathParameters?: Record<string, string>;
    body?: MetadataValueInput;
    context?: { userContext?: { userId?: string } };
  }) => {
    const metadataTypeCode = codeFromReq(req);
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    const raw = (req.body ?? {}) as MetadataValueInput & Record<string, unknown>;
    assertPostMetadataValueRequiredBody(raw);
    const valueCode = (raw.valueCode ?? raw.metadataValueCode) as string;
    const existing = await getValue(metadataTypeCode, valueCode);
    const body = normalizeMetadataValueInput(
      { ...raw, valueCode, metadataValueCode: valueCode } as MetadataValueInput & Record<string, unknown>,
      existing,
    );
    const record = await upsertMetadataValue(
      metadataTypeCode,
      body,
      req.context?.userContext?.userId,
      existing,
    );
    return flattenMetadataValueForApi(record);
  },
  { useCreated: false },
);
