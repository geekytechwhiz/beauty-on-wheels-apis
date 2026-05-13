import { ValidationError } from '../domain/errors';

/**
 * Normalized path/query fields for routes shaped like `/metadata/:entityType/...`
 * (GET metadata, list audit, etc.).
 */
export type RegistryEntityPathExtract = {
  entityTypeRaw: string;
  kind: string;
  metadataTypeCode: string;
  valueCode: string;
};

export function extractRegistryEntityPath(
  q: Record<string, string | undefined>,
  p: Record<string, string | undefined>,
): RegistryEntityPathExtract {
  const entityTypeRaw = (q.entityType ?? p.entityType ?? '').trim();
  const kind = entityTypeRaw.toLowerCase();
  const metadataTypeCode = (q.metadataTypeCode ?? p.metadataTypeCode ?? '').trim();
  const valueCode = (q.metadataValueCode ?? q.valueCode ?? p.metadataValueCode ?? '').trim();
  return { entityTypeRaw, kind, metadataTypeCode, valueCode };
}

/** Validates `entityType` path segment is present and `type` | `value`. */
export function assertRegistryEntityKind(entityTypeRaw: string): 'type' | 'value' {
  const trimmed = entityTypeRaw.trim();
  if (!trimmed) {
    throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
  }
  const kind = trimmed.toLowerCase();
  if (kind === 'type' || kind === 'value') {
    return kind;
  }
  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
}

export type RegistryPathValueCodeMissingStyle = 'get' | 'auditLike';

/**
 * After {@link assertRegistryEntityKind}, ensures type/value-specific codes are present.
 * Message shapes match legacy handlers (GET single vs audit/PATCH-style copy).
 */
export function assertRegistryPathCodesForKind(
  kind: 'type' | 'value',
  metadataTypeCode: string,
  valueCode: string,
  valueMissingStyle: RegistryPathValueCodeMissingStyle,
): void {
  if (kind === 'type') {
    if (!metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
    }
    return;
  }
  if (!metadataTypeCode) {
    throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
  }
  if (!valueCode) {
    if (valueMissingStyle === 'get') {
      throw new ValidationError('metadataValueCode is required', [{ field: 'metadataValueCode', message: 'Required' }]);
    }
    throw new ValidationError('metadataTypeCode and metadataValueCode are required', [
      { field: 'metadataValueCode', message: 'valueCode or metadataValueCode is required' },
    ]);
  }
}

/** Non-empty `metadataTypeCode` on JSON body (POST/PATCH registry routes). */
export function assertMetadataTypeCodePresentOnBody(body: Record<string, unknown> | undefined): string {
  const code = body?.metadataTypeCode;
  if (code === undefined || code === null || typeof code !== 'string' || code.trim() === '') {
    throw new ValidationError('metadataTypeCode is required', [
      {
        field: 'metadataTypeCode',
        message:
          code !== undefined && code !== null && typeof code !== 'string' ? 'Must be a string' : 'Required',
      },
    ]);
  }
  return code.trim();
}

/** Non-empty value identity on JSON body (`valueCode` or `metadataValueCode`), PATCH status route. */
export function assertValueCodePresentOnPatchBody(body: Record<string, unknown>): string {
  const valueCode = (body.valueCode ?? body.metadataValueCode) as string | undefined;
  if (valueCode === undefined || valueCode === null || String(valueCode).trim() === '') {
    throw new ValidationError('metadataTypeCode and metadataValueCode are required', [
      { field: 'metadataValueCode', message: 'valueCode or metadataValueCode is required' },
    ]);
  }
  return String(valueCode).trim();
}
