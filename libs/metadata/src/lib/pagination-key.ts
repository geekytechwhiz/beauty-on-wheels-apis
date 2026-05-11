import { ValidationError } from '../domain/errors';

/** Client cursor: base64(JSON.stringify(DynamoDB ExclusiveStartKey)). */
export function encodePaginationKey(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | undefined {
  if (lastEvaluatedKey === undefined || Object.keys(lastEvaluatedKey).length === 0) {
    return undefined;
  }
  try {
    const json = JSON.stringify(lastEvaluatedKey);
    return Buffer.from(json, 'utf8').toString('base64url');
  } catch {
    throw new ValidationError('Invalid pagination state', [
      { field: 'nextPaginationKey', message: 'Could not encode pagination key' },
    ]);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Decodes a client token to a Dynamo `ExclusiveStartKey`.
 * @param pkAttr Table partition key name (e.g. PK) — must appear in the decoded object when non-empty.
 * @param skAttr Table sort key name (e.g. SK)
 */
export function decodePaginationKey(
  token: string,
  pkAttr: string,
  skAttr: string,
): Record<string, unknown> {
  const trimmed = String(token).trim();
  if (trimmed === '') {
    throw new ValidationError('nextPaginationKey is invalid', [
      { field: 'nextPaginationKey', message: 'Token is empty' },
    ]);
  }
  let json: string;
  try {
    json = Buffer.from(trimmed, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('nextPaginationKey is invalid', [
      { field: 'nextPaginationKey', message: 'Token is not valid base64url' },
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new ValidationError('nextPaginationKey is invalid', [
      { field: 'nextPaginationKey', message: 'Token payload is not valid JSON' },
    ]);
  }
  if (!isPlainObject(parsed)) {
    throw new ValidationError('nextPaginationKey is invalid', [
      { field: 'nextPaginationKey', message: 'Token payload must be a JSON object' },
    ]);
  }
  if (typeof parsed[pkAttr] !== 'string' || typeof parsed[skAttr] !== 'string') {
    throw new ValidationError('nextPaginationKey is invalid', [
      { field: 'nextPaginationKey', message: 'Token is missing table primary key attributes' },
    ]);
  }
  return parsed;
}
