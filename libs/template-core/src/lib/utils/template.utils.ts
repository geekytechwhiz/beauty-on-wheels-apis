import { ENV_TEMPLATE_TABLE, VERSION_SK_PREFIX } from '../constants/template.constants';
import { TemplateKeyBuilder } from '../builder/template-key.builder';

export function assertTemplateTable(): string {
  const table = process.env[ENV_TEMPLATE_TABLE];
  if (!table?.trim()) {
    throw new Error(`${ENV_TEMPLATE_TABLE} environment variable is not set`);
  }
  return table;
}

export function encodeListCursor(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | undefined {
  if (!lastEvaluatedKey || Object.keys(lastEvaluatedKey).length === 0) return undefined;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');
}

export function decodeListCursor(token: string | undefined): Record<string, unknown> | undefined {
  const t = token?.trim();
  if (!t) return undefined;
  try {
    const json = Buffer.from(t, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalidListCursor();
    }
    return parsed as Record<string, unknown>;
  } catch {
    invalidListCursor();
  }
}

function invalidListCursor(): never {
  const e = new Error('Invalid nextToken') as Error & { statusCode: number; code: string };
  e.statusCode = 400;
  e.code = 'VALIDATION_ERROR';
  throw e;
}

/** Map API version query (`V01`, `001`, `VERSION#001`) to DynamoDB sort key. */
export function normalizeVersionToSk(version: string): string {
  const trimmed = version.trim();
  if (trimmed.toUpperCase().startsWith(VERSION_SK_PREFIX)) {
    return TemplateKeyBuilder.toVersionSk(trimmed);
  }
  const vSuffix = trimmed.match(/^V(\d+)$/i);
  if (vSuffix) {
    return `${VERSION_SK_PREFIX}${String(parseInt(vSuffix[1], 10)).padStart(3, '0')}`;
  }
  if (/^\d+$/.test(trimmed)) {
    return `${VERSION_SK_PREFIX}${String(parseInt(trimmed, 10)).padStart(3, '0')}`;
  }
  return TemplateKeyBuilder.toVersionSk(trimmed);
}

export function templateVersionIdToSk(templateVersionId: string): string | undefined {
  const match = templateVersionId.match(/-V(\d+)$/i);
  if (!match) return undefined;
  return `${VERSION_SK_PREFIX}${String(parseInt(match[1], 10)).padStart(3, '0')}`;
}

export function templateNotFoundError(message = 'Master template not found'): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 404;
  e.code = 'NOT_FOUND';
  throw e;
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
    return value[0].trim();
  }
  return undefined;
}
