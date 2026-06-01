import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  resolveTemplateTypeForMetaId,
  UI_META_CANONICAL_FILE,
  UI_META_LEGACY_FILES,
  type TemplateUiMetaType,
} from '../constants/template-ui-meta.constants';
import type { TemplateUiMetaDocument } from '../models/api/template-ui-meta.types';

export function templateUiMetaValidationError(message: string): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  throw err;
}

export function templateUiMetaNotFoundError(message = 'UI meta not found'): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 404;
  err.code = 'NOT_FOUND';
  throw err;
}

/** Resolves `services-json` directory for local UI meta file storage. */
export function resolveServicesJsonDir(): string {
  const envDir = process.env.TEMPLATE_UI_META_DIR?.trim();
  if (envDir) {
    const normalizedEnvDir = envDir.replace(/\\/g, '/');
    const cwd = process.cwd().replace(/\\/g, '/');
    const envLooksRepoRelative = normalizedEnvDir.startsWith('apps/template-service/');
    const cwdIsTemplateService = cwd.endsWith('/apps/template-service');
    const safeEnvDir =
      envLooksRepoRelative && cwdIsTemplateService
        ? normalizedEnvDir.replace(/^apps\/template-service\//, '')
        : envDir;

    const resolvedEnvDir = path.resolve(safeEnvDir);
    if (existsSync(resolvedEnvDir)) {
      return resolvedEnvDir;
    }
  }

  const cwd = process.cwd().replace(/\\/g, '/').toLowerCase();
  const isTemplateServiceCwd = cwd.endsWith('/apps/template-service');

  const candidates = [
    path.resolve(process.cwd(), 'services-json'),
    path.resolve(process.cwd(), 'apps/template-service/services-json'),
    ...(isTemplateServiceCwd
      ? []
      : [path.resolve(process.cwd(), 'apps/template-service/libs/template-core/src/services-json')]),
    ...(isTemplateServiceCwd ? [path.resolve(process.cwd(), 'libs/template-core/src/services-json')] : []),
    path.resolve(process.cwd(), 'libs/template-core/src/services-json'),
    path.resolve(process.cwd(), '../libs/template-core/src/services-json'),
    path.resolve(__dirname, '../../../../../../apps/template-service/libs/template-core/src/services-json'),
    path.resolve(__dirname, '../../../services-json'),
    path.resolve(__dirname, '../../../../template-core/src/services-json'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  return candidates[0];
}

export function candidateUiMetaFileNames(templateType: TemplateUiMetaType): string[] {
  const names = [UI_META_CANONICAL_FILE[templateType]];
  const legacy = UI_META_LEGACY_FILES[templateType] ?? [];
  for (const legacyName of legacy) {
    if (!names.includes(legacyName)) names.push(legacyName);
  }
  return names;
}

export function parseUiMetaDocument(raw: string, fileName: string): TemplateUiMetaDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    templateUiMetaValidationError(`Invalid JSON in ${fileName}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    templateUiMetaValidationError(`UI meta root must be an object (${fileName})`);
  }
  const doc = parsed as Record<string, unknown>;
  const id = typeof doc.id === 'string' ? doc.id.trim() : '';
  if (!id) {
    templateUiMetaValidationError(`UI meta must include string "id" (${fileName})`);
  }
  return { ...doc, id } as TemplateUiMetaDocument;
}

export function assertUiMetaUpsertBody(body: unknown): TemplateUiMetaDocument {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    templateUiMetaValidationError('Request body must be a JSON object');
  }
  const doc = body as Record<string, unknown>;
  const id = typeof doc.id === 'string' ? doc.id.trim() : '';
  if (!id) {
    templateUiMetaValidationError('UI meta body must include string "id"');
  }
  if (!doc.fields || typeof doc.fields !== 'object' || Array.isArray(doc.fields)) {
    templateUiMetaValidationError('UI meta body must include object "fields"');
  }
  return doc as TemplateUiMetaDocument;
}

export function inferTemplateUiMetaTypeFromFileName(
  fileName: string,
): TemplateUiMetaType | undefined {
  const lower = fileName.toLowerCase();
  if (lower.includes('alert')) return 'ALERT_POLICY';
  if (lower.includes('monitoring')) return 'MONITORING';
  if (lower.includes('goal')) return 'GOAL';
  if (lower.includes('task')) return 'TASK';
  if (lower.includes('threshold')) return 'THRESHOLD';
  if (lower.includes('symptom')) return 'SYMPTOM';
  return undefined;
}

export function resolveTemplateTypeForUiMetaDocument(
  doc: TemplateUiMetaDocument,
  fileName: string,
): TemplateUiMetaType | undefined {
  return resolveTemplateTypeForMetaId(doc.id) ?? inferTemplateUiMetaTypeFromFileName(fileName);
}
