import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  normalizeTemplateUiMetaType,
  resolveTemplateTypeForMetaId,
  TEMPLATE_UI_META_TYPES,
  UI_META_CANONICAL_FILE,
  UI_META_LEGACY_FILES,
  type TemplateUiMetaType,
} from '../constants/template-ui-meta.constants';

export type TemplateUiMetaDocument = Record<string, unknown> & {
  id: string;
  titleKey?: string;
  subtitleKey?: string;
  fields?: Record<string, unknown>;
};

export type TemplateUiMetaListItem = {
  templateType: TemplateUiMetaType;
  metaId: string;
  fileName: string;
  document: TemplateUiMetaDocument;
};

export type TemplateUiMetaGetResult = {
  metaId: string;
  templateType: TemplateUiMetaType;
  fileName: string;
  document: TemplateUiMetaDocument;
};

function templateValidationError(message: string): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  throw err;
}

function templateNotFoundError(message = 'UI meta not found'): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 404;
  err.code = 'NOT_FOUND';
  throw err;
}

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

function candidateFileNames(templateType: TemplateUiMetaType): string[] {
  const names = [UI_META_CANONICAL_FILE[templateType]];
  const legacy = UI_META_LEGACY_FILES[templateType] ?? [];
  for (const legacyName of legacy) {
    if (!names.includes(legacyName)) names.push(legacyName);
  }
  return names;
}

function parseUiMetaDocument(raw: string, fileName: string): TemplateUiMetaDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    templateValidationError(`Invalid JSON in ${fileName}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    templateValidationError(`UI meta root must be an object (${fileName})`);
  }
  const doc = parsed as Record<string, unknown>;
  const id = typeof doc.id === 'string' ? doc.id.trim() : '';
  if (!id) {
    templateValidationError(`UI meta must include string "id" (${fileName})`);
  }
  return { ...doc, id } as TemplateUiMetaDocument;
}

function assertUpsertBody(body: unknown): TemplateUiMetaDocument {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    templateValidationError('Request body must be a JSON object');
  }
  const doc = body as Record<string, unknown>;
  const id = typeof doc.id === 'string' ? doc.id.trim() : '';
  if (!id) {
    templateValidationError('UI meta body must include string "id"');
  }
  if (!doc.fields || typeof doc.fields !== 'object' || Array.isArray(doc.fields)) {
    templateValidationError('UI meta body must include object "fields"');
  }
  return doc as TemplateUiMetaDocument;
}

export class TemplateUiMetaService {
  constructor(private readonly baseDir = resolveServicesJsonDir()) {}

  async listUiMeta(): Promise<TemplateUiMetaListItem[]> {
    await mkdir(this.baseDir, { recursive: true });
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const items: TemplateUiMetaListItem[] = [];
    const seenIds = new Set<string>();

    for (const templateType of TEMPLATE_UI_META_TYPES) {
      for (const fileName of candidateFileNames(templateType)) {
        const fullPath = path.join(this.baseDir, fileName);
        if (!existsSync(fullPath)) continue;
        try {
          const raw = await readFile(fullPath, 'utf-8');
          const doc = parseUiMetaDocument(raw, fileName);
          if (seenIds.has(doc.id)) continue;
          seenIds.add(doc.id);
          items.push({ templateType, metaId: doc.id, fileName, document: doc });
        } catch {
          // skip unreadable files in list
        }
      }
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fullPath = path.join(this.baseDir, entry.name);
      try {
        const raw = await readFile(fullPath, 'utf-8');
        const doc = parseUiMetaDocument(raw, entry.name);
        if (seenIds.has(doc.id)) continue;
        const templateType = resolveTemplateTypeForMetaId(doc.id);
        if (!templateType) continue;
        seenIds.add(doc.id);
        items.push({ templateType, metaId: doc.id, fileName: entry.name, document: doc });
      } catch {
        // skip
      }
    }

    return items;
  }

  async getUiMetaById(metaId: string): Promise<TemplateUiMetaGetResult> {
    const normalizedId = metaId.trim();
    if (!normalizedId) {
      templateValidationError('metaId is required');
    }

    await mkdir(this.baseDir, { recursive: true });
    const entries = await readdir(this.baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fileName = entry.name;
      const fullPath = path.join(this.baseDir, fileName);
      const raw = await readFile(fullPath, 'utf-8');
      const doc = parseUiMetaDocument(raw, fileName);
      if (doc.id !== normalizedId) continue;

      const templateType =
        resolveTemplateTypeForMetaId(doc.id) ?? this.inferTypeFromFileName(fileName);
      if (!templateType) continue;

      return { metaId: doc.id, templateType, fileName, document: doc };
    }

    templateNotFoundError(`UI meta not found for id ${normalizedId}`);
  }

  async getUiMetaByTemplateType(templateTypeRaw: string): Promise<TemplateUiMetaGetResult> {
    const templateType = normalizeTemplateUiMetaType(templateTypeRaw);
    if (!templateType) {
      templateValidationError(
        `Invalid templateType. Allowed: ${TEMPLATE_UI_META_TYPES.join(', ')}`,
      );
    }

    for (const fileName of candidateFileNames(templateType)) {
      const fullPath = path.join(this.baseDir, fileName);
      if (!existsSync(fullPath)) continue;
      const raw = await readFile(fullPath, 'utf-8');
      const doc = parseUiMetaDocument(raw, fileName);
      return { metaId: doc.id, templateType, fileName, document: doc };
    }

    templateNotFoundError(`UI meta file not found for template type ${templateType}`);
  }

  /**
   * Create or update UI meta JSON for a template type (single upsert API).
   * Writes canonical filename under `services-json` and removes legacy "(1)" copies.
   */
  async upsertUiMeta(
    templateTypeRaw: string,
    body: unknown,
  ): Promise<TemplateUiMetaGetResult> {
    const templateType = normalizeTemplateUiMetaType(templateTypeRaw);
    if (!templateType) {
      templateValidationError(
        `Invalid templateType. Allowed: ${TEMPLATE_UI_META_TYPES.join(', ')}`,
      );
    }

    const document = assertUpsertBody(body);
    const expectedType = resolveTemplateTypeForMetaId(document.id);
    const typeMatches =
      !expectedType ||
      expectedType === templateType ||
      (expectedType === 'ALERT_POLICY' && templateType === 'ALERT');
    if (!typeMatches) {
      templateValidationError(
        `meta id "${document.id}" does not match template type ${templateType}`,
      );
    }

    await mkdir(this.baseDir, { recursive: true });
    const canonicalName = UI_META_CANONICAL_FILE[templateType];
    const targetPath = path.join(this.baseDir, canonicalName);
    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');

    for (const legacyName of UI_META_LEGACY_FILES[templateType] ?? []) {
      const legacyPath = path.join(this.baseDir, legacyName);
      if (legacyPath !== targetPath && existsSync(legacyPath)) {
        await unlink(legacyPath);
      }
    }

    return {
      metaId: document.id,
      templateType,
      fileName: canonicalName,
      document,
    };
  }

  private inferTypeFromFileName(fileName: string): TemplateUiMetaType | undefined {
    const lower = fileName.toLowerCase();
    if (lower.includes('alert')) return 'ALERT_POLICY';
    if (lower.includes('monitoring')) return 'MONITORING';
    if (lower.includes('goal')) return 'GOAL';
    if (lower.includes('task')) return 'TASK';
    if (lower.includes('threshold')) return 'THRESHOLD';
    if (lower.includes('symptom')) return 'SYMPTOM';
    return undefined;
  }
}
