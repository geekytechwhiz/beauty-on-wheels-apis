import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const LAMBDA_WRITABLE_SERVICES_JSON = path.posix.join(
  '/tmp',
  'template-service',
  'services-json',
);

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

export function isLambdaRuntime(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME ?? process.env.LAMBDA_TASK_ROOT);
}

/**
 * Read-only packaged services-json directory bundled with Lambda code.
 * Useful as fallback for GET/list when writable /tmp has no files yet.
 */
// export function resolveBundledServicesJsonDir(): string | undefined {
//   const root = process.env.LAMBDA_TASK_ROOT ?? '/var/task';
//   const bundled = path.posix.join(root.replace(/\\/g, '/'), 'services-json');
//   return existsSync(bundled) ? bundled : undefined;
// }

function resolveEnvServicesJsonDir(envDir: string): string {
  const normalizedEnvDir = envDir.replace(/\\/g, '/');
  const isWindowsAbsolute = /^[a-zA-Z]:\//.test(normalizedEnvDir) || normalizedEnvDir.startsWith('//');

  if (isLambdaRuntime()) {
    // serverless-offline on Windows can set Lambda env vars; keep absolute OS paths as-is.
    if (path.posix.isAbsolute(normalizedEnvDir) || isWindowsAbsolute) {
      return path.resolve(envDir);
    }
    return path.posix.join('/tmp', 'template-service', normalizedEnvDir);
  }

  const cwd = process.cwd().replace(/\\/g, '/');
  const envLooksRepoRelative = normalizedEnvDir.startsWith('apps/template-service/');
  const cwdIsTemplateService = cwd.endsWith('/apps/template-service');
  const safeEnvDir =
    envLooksRepoRelative && cwdIsTemplateService
      ? normalizedEnvDir.replace(/^apps\/template-service\//, '')
      : envDir;

  return path.resolve(safeEnvDir);
}

/** Resolves `services-json` directory for UI meta file storage (local or Lambda /tmp). */
export function resolveServicesJsonDir(): string {
  const envDir = process.env.TEMPLATE_UI_META_DIR?.trim();
  if (envDir) {
    const resolvedEnvDir = resolveEnvServicesJsonDir(envDir);
    if (existsSync(resolvedEnvDir) || isLambdaRuntime()) {
      return resolvedEnvDir;
    }
  }

  if (isLambdaRuntime()) {
    return LAMBDA_WRITABLE_SERVICES_JSON;
  }

  const cwd = process.cwd().replace(/\\/g, '/').toLowerCase();
  const isTemplateServiceCwd = cwd.endsWith('/apps/template-service');

  const candidates = [
    path.resolve(process.cwd(), 'services-json'),
    path.resolve(process.cwd(), 'apps/template-service/services-json'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  return candidates[0];
}

/** Bundled read-only `services-json` shipped in the Lambda deployment package. */
export function resolveBundledServicesJsonDir(): string | undefined {
  if (!isLambdaRuntime()) return undefined;
  const taskRoot = process.env.LAMBDA_TASK_ROOT ?? '/var/task';
  const bundledDir = path.join(taskRoot, 'services-json');
  return existsSync(bundledDir) ? bundledDir : undefined;
}

/**
 * Copies bundled `*.json` into the writable runtime dir on cold start.
 * Skips files that already exist so warm-container updates are preserved.
 */
export async function seedServicesJsonFromBundle(targetDir: string): Promise<void> {
  const bundledDir = resolveBundledServicesJsonDir();
  if (!bundledDir) return;

  const entries = await readdir(bundledDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const destPath = path.join(targetDir, entry.name);
    if (existsSync(destPath)) continue;
    await copyFile(path.join(bundledDir, entry.name), destPath);
  }
}

/**
 * Ensures the writable services-json directory exists.
 * Flow contract: create/update writes here, and get/list reads only from here.
 */
export async function prepareServicesJsonDir(baseDir?: string): Promise<string> {
  const dir = baseDir ?? resolveServicesJsonDir();
  await mkdir(dir, { recursive: true });
  if (isLambdaRuntime()) {
    await seedServicesJsonFromBundle(dir);
  }
  return dir;
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

export type CreateUiMetaBody = {
  templateType: string;
  fileName?: string;
  document: TemplateUiMetaDocument;
};

export function assertCreateUiMetaBody(body: unknown): CreateUiMetaBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    templateUiMetaValidationError('Request body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;
  const templateType =
    typeof raw.templateType === 'string' ? raw.templateType.trim() : '';
  if (!templateType) {
    templateUiMetaValidationError('templateType is required');
  }

  const fileName =
    typeof raw.fileName === 'string' && raw.fileName.trim()
      ? raw.fileName.trim()
      : undefined;

  const { templateType: _t, fileName: _f, ...rest } = raw;
  const document = assertUiMetaUpsertBody(rest);

  return { templateType, fileName, document };
}

export function isOrgConfigMetaFileName(
  fileName: string,
  orgConfigFileNames?: Set<string>,
): boolean {
  if (orgConfigFileNames?.has(fileName)) return true;
  const lower = fileName.toLowerCase();
  return (
    lower === 'org-drawer.json' ||
    lower === 'org-manageibility.json' ||
    lower === 'enable-scope.json' ||
    lower.startsWith('org-config-')
  );
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
