import {
  ENV_TEMPLATE_TABLE,
  TEMPLATE_STATUS,
  VERSION_SK_PREFIX,
  type TemplateStatus,
} from '../constants/template.constants';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import { TemplateKeyBuilder } from '../builder/template-key.builder';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { normalizeTemplateActor } from './template-actor.utils';

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
  const e = new Error('Invalid nextPaginationKey') as Error & { statusCode: number; code: string };
  e.statusCode = 400;
  e.code = 'VALIDATION_ERROR';
  throw e;
}

/** Map API version query (`V01`, `001`, `VERSION#001`, `TASK-CODE-V01`) to DynamoDB sort key. */
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
  // Full templateVersionId (e.g. `TASK-CODE-V01`) — resolve the trailing `-V<n>` segment.
  const idSuffix = trimmed.match(/-V(\d+)$/i);
  if (idSuffix) {
    return `${VERSION_SK_PREFIX}${String(parseInt(idSuffix[1], 10)).padStart(3, '0')}`;
  }
  return TemplateKeyBuilder.toVersionSk(trimmed);
}

export function templateVersionIdToSk(templateVersionId: string): string | undefined {
  const match = templateVersionId.match(/-V(\d+)$/i);
  if (!match) return undefined;
  return `${VERSION_SK_PREFIX}${String(parseInt(match[1], 10)).padStart(3, '0')}`;
}

/**
 * Display version for API (e.g. 1.2). Prefers stored `meta.version` (in-place master publishes)
 * over the major segment in `templateVersionId` (`-V01` → 1).
 */
export function resolveTemplateDisplayVersion(meta: {
  version?: number;
  templateVersionId?: string;
}): number {
  if (typeof meta.version === 'number' && Number.isFinite(meta.version) && meta.version > 0) {
    return meta.version;
  }
  const id = meta.templateVersionId?.trim();
  if (id) {
    const match = id.match(/-V(\d+)$/i);
    if (match) return parseInt(match[1], 10);
  }
  return 1;
}

/** @deprecated Use {@link resolveTemplateDisplayVersion} */
export function parseVersionNumberFromTemplateVersionId(
  templateVersionId: string,
  fallbackVersion?: number,
): number {
  return resolveTemplateDisplayVersion({
    templateVersionId,
    version: fallbackVersion,
  });
}

export function formatTemplateVersionLabel(versionNum: number): string {
  return `v${versionNum}`;
}

export function compareTemplateDisplayVersions(a: number, b: number): number {
  return a - b;
}

export function templateConflictError(message: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 409;
  e.code = 'CONFLICT';
  throw e;
}

export function templateValidationError(message: string): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 400;
  e.code = 'VALIDATION_ERROR';
  throw e;
}

export function templateNotFoundError(message = 'Master template not found'): never {
  const e = new Error(message) as Error & { statusCode: number; code: string };
  e.statusCode = 404;
  e.code = 'NOT_FOUND';
  throw e;
}

/** First version on create; each in-place save bumps minor (1 → 1.1 → 1.2). */
export function bumpMinorVersion(current: number | undefined): number {
  const v = current ?? 1;
  if (Number.isInteger(v)) {
    return Math.round((v + 0.1) * 10) / 10;
  }
  return Math.round((v + 0.1) * 10) / 10;
}

/** Default when `meta.isActive` is unset: PUBLISHED → active; DRAFT and other statuses → inactive. */
export function isActiveForStatus(status: TemplateStatus | string): boolean {
  return status === TEMPLATE_STATUS.PUBLISHED;
}

/** Master list/dashboard: honor stored `isActive`; published templates may be inactive when `active: false`. */
export function resolveMasterTemplateIsActive(meta: {
  status?: TemplateStatus | string;
  isActive?: boolean;
}): boolean {
  if (typeof meta.isActive === 'boolean') {
    return meta.isActive;
  }
  return isActiveForStatus(meta.status ?? TEMPLATE_STATUS.DRAFT);
}

/** API responses: profile fields are only in `fieldValues`, not duplicated on `meta`. */
export function sanitizeMetaForApi(meta: TemplateMeta): TemplateMeta {
  const copy = { ...meta };
  delete copy.category;
  delete copy.condition;
  delete copy.shareScope;
  delete copy.templateDescription;
  const createdBy = normalizeTemplateActor(copy.createdBy);
  if (createdBy) copy.createdBy = createdBy;
  const lastModifiedBy = normalizeTemplateActor(copy.lastModifiedBy);
  if (lastModifiedBy) copy.lastModifiedBy = lastModifiedBy;
  const publishedBy = normalizeTemplateActor(copy.publishedBy);
  if (publishedBy) copy.publishedBy = publishedBy;
  else if (copy.publishedBy === null) copy.publishedBy = null;
  return copy;
}

export function pickHighestVersionRow(items: TemplateDdbRecord[]): TemplateDdbRecord | null {
  if (items.length === 0) return null;
  return items.reduce((best, cur) => {
    const bestVer = best.meta?.version ?? 0;
    const curVer = cur.meta?.version ?? 0;
    return curVer >= bestVer ? cur : best;
  });
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
    return value[0].trim();
  }
  return undefined;
}
