import { STATUS, ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import type { MetadataTypeInput, MetadataValueInput } from '@api-hub/metadata';
import {
  flattenMetadataValueForApi,
  getValue,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
  upsertMetadataType,
  upsertMetadataValue,
} from '../services/metadataService';

const APPLICABILITY_KEYS = [
  'applicableModules',
  'applicableCategories',
  'applicableConditions',
  'applicableCountries',
] as const;

type PostMetadataRequest = {
  params?: Record<string, string>;
  pathParameters?: Record<string, string>;
  body?: Record<string, unknown>;
  context?: { userContext?: { userId?: string } };
};

/**
 * Enforces required fields on every POST (create and update) for metadata values:
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

function resolveEntityType(req: PostMetadataRequest): string {
  return (req.params?.entityType ?? req.pathParameters?.entityType ?? '').trim();
}

async function handlePostMetadataType(
  body: Record<string, unknown> | undefined,
  userId: string | undefined,
) {
  const code = body?.metadataTypeCode;
  if (code === undefined || code === null || typeof code !== 'string' || code.trim() === '') {
    throw new ValidationError('metadataTypeCode is required', [
      {
        field: 'metadataTypeCode',
        message: code !== undefined && code !== null && typeof code !== 'string' ? 'Must be a string' : 'Required',
      },
    ]);
  }
  return upsertMetadataType(
    normalizeMetadataTypeInput(body as MetadataTypeInput & Record<string, unknown>),
    userId,
  );
}

async function handlePostMetadataValue(
  body: Record<string, unknown> | undefined,
  userId: string | undefined,
) {
  const raw = (body ?? {}) as MetadataValueInput & Record<string, unknown>;
  const typeCodeRaw = raw.metadataTypeCode;
  if (typeCodeRaw === undefined || typeCodeRaw === null || typeof typeCodeRaw !== 'string' || typeCodeRaw.trim() === '') {
    throw new ValidationError('metadataTypeCode is required', [
      {
        field: 'metadataTypeCode',
        message:
          typeCodeRaw !== undefined && typeCodeRaw !== null && typeof typeCodeRaw !== 'string' ? 'Must be a string' : 'Required',
      },
    ]);
  }
  assertPostMetadataValueRequiredBody(raw);
  const metadataTypeCode = typeCodeRaw.trim();
  const valueCode = (raw.valueCode ?? raw.metadataValueCode) as string;
  const existing = await getValue(metadataTypeCode, valueCode);
  const normalized = normalizeMetadataValueInput(
    { ...raw, valueCode, metadataValueCode: valueCode } as MetadataValueInput & Record<string, unknown>,
    existing,
  );
  const record = await upsertMetadataValue(metadataTypeCode, normalized, userId, existing);
  return flattenMetadataValueForApi(record);
}

export const main = withLambdaHandler(
  async (req: PostMetadataRequest) => {
    const entityType = resolveEntityType(req);
    if (!entityType) {
      throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
    }
    const kind = entityType.toLowerCase();
    const userId = req.context?.userContext?.userId;
    if (kind === 'type') {
      return handlePostMetadataType(req.body, userId);
    }
    if (kind === 'value') {
      return handlePostMetadataValue(req.body, userId);
    }
    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  },
  { useCreated: false },
);
