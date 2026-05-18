import { ENV_TEMPLATE_TABLE } from '../constants/template.constants';

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

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
    return value[0].trim();
  }
  return undefined;
}
