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

export const REGISTRY_POST_METADATA_ACTIONS = ['draft', 'impact-preview', 'publish', 'cancel'] as const;
export type RegistryPostMetadataAction = (typeof REGISTRY_POST_METADATA_ACTIONS)[number];

/** POST actions implemented in the current release. */
export const REGISTRY_POST_METADATA_IMPLEMENTED_ACTIONS = [
  'draft',
  'impact-preview',
  'publish',
  'cancel',
] as const;
export type RegistryPostMetadataImplementedAction = (typeof REGISTRY_POST_METADATA_IMPLEMENTED_ACTIONS)[number];

/** Requires supported `action` query param on POST `/metadata/{entityType}` (managed publish workflow). */
export function assertRegistryPostMetadataAction(actionRaw: string): RegistryPostMetadataImplementedAction {
  const trimmed = actionRaw.trim().toLowerCase();
  if (!trimmed) {
    throw new ValidationError(
      'Query parameter action is required. Use action=draft, action=impact-preview, action=publish, or action=cancel.',
      [{ field: 'action', message: 'Required' }],
    );
  }
  if (!REGISTRY_POST_METADATA_ACTIONS.includes(trimmed as RegistryPostMetadataAction)) {
    throw new ValidationError(
      `Invalid action "${actionRaw.trim()}". Allowed values: draft, impact-preview, publish, cancel.`,
      [{ field: 'action', message: 'Must be draft, impact-preview, publish, or cancel' }],
    );
  }
  return trimmed as RegistryPostMetadataImplementedAction;
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

/** Non-empty change-request id on JSON body (`action=publish`, draft impact preview). */
export function assertChangeRequestIdPresentOnBody(body: Record<string, unknown>): string {
  const id = body.changeRequestId;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ValidationError('changeRequestId is required', [
      { field: 'changeRequestId', message: 'Required' },
    ]);
  }
  return id.trim();
}

/** Crockford Base32 ULID (26 chars) — ids assigned by `action=draft`. */
export const CHANGE_REQUEST_ID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Non-empty change-request id on GET `/metadata/change-requests/{changeRequestId}`. */
export function assertChangeRequestIdPathParam(changeRequestIdRaw: string | undefined): string {
  const trimmed = (changeRequestIdRaw ?? '').trim();
  if (!trimmed) {
    throw new ValidationError('changeRequestId is required', [
      { field: 'changeRequestId', message: 'Required' },
    ]);
  }
  if (!CHANGE_REQUEST_ID_PATTERN.test(trimmed)) {
    throw new ValidationError('changeRequestId must be a valid ULID', [
      { field: 'changeRequestId', message: 'Invalid format' },
    ]);
  }
  return trimmed;
}

export interface MetadataPublishRequestBody {
  changeRequestId: string;
  confirmationAcknowledged: boolean;
  expectedBaseVersion: number | null;
}

function parseExpectedBaseVersion(raw: unknown): number | null {
  if (raw === null) {
    return null;
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) {
    return raw;
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    return parseInt(raw.trim(), 10);
  }
  throw new ValidationError('expectedBaseVersion must be null or a positive integer', [
    { field: 'expectedBaseVersion', message: 'Invalid' },
  ]);
}

/** POST `?action=publish` body — all three fields required. */
export function assertMetadataPublishRequestBody(body: Record<string, unknown>): MetadataPublishRequestBody {
  const changeRequestId = assertChangeRequestIdPresentOnBody(body);

  if (!Object.prototype.hasOwnProperty.call(body, 'confirmationAcknowledged')) {
    throw new ValidationError('confirmationAcknowledged is required for publish', [
      { field: 'confirmationAcknowledged', message: 'Required' },
    ]);
  }
  if (typeof body.confirmationAcknowledged !== 'boolean') {
    throw new ValidationError('confirmationAcknowledged must be a boolean', [
      { field: 'confirmationAcknowledged', message: 'Must be boolean' },
    ]);
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'expectedBaseVersion')) {
    throw new ValidationError('expectedBaseVersion is required for publish', [
      { field: 'expectedBaseVersion', message: 'Required' },
    ]);
  }

  return {
    changeRequestId,
    confirmationAcknowledged: body.confirmationAcknowledged,
    expectedBaseVersion: parseExpectedBaseVersion(body.expectedBaseVersion),
  };
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
