import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  normalizeTemplateUiMetaType,
  resolveTemplateTypeForMetaId,
  TEMPLATE_UI_META_TYPES,
  UI_META_CANONICAL_FILE,
  UI_META_LEGACY_FILES,
} from '../constants/template-ui-meta.constants';
import type { TemplateUiMetaGetResult, TemplateUiMetaListItem } from '../models/api/template-ui-meta.types';
import {
  assertUiMetaUpsertBody,
  candidateUiMetaFileNames,
  parseUiMetaDocument,
  resolveServicesJsonDir,
  resolveTemplateTypeForUiMetaDocument,
  templateUiMetaNotFoundError,
  templateUiMetaValidationError,
} from '../utils/template-ui-meta.utils';

export type {
  TemplateUiMetaDocument,
  TemplateUiMetaGetResult,
  TemplateUiMetaListItem,
} from '../models/api/template-ui-meta.types';
export { resolveServicesJsonDir } from '../utils/template-ui-meta.utils';

export class TemplateUiMetaService {
  constructor(private readonly baseDir = resolveServicesJsonDir()) {}

  async listUiMeta(): Promise<TemplateUiMetaListItem[]> {
    await mkdir(this.baseDir, { recursive: true });
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const items: TemplateUiMetaListItem[] = [];
    const seenIds = new Set<string>();

    for (const templateType of TEMPLATE_UI_META_TYPES) {
      for (const fileName of candidateUiMetaFileNames(templateType)) {
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
      templateUiMetaValidationError('metaId is required');
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

      const templateType = resolveTemplateTypeForUiMetaDocument(doc, fileName);
      if (!templateType) continue;

      return { metaId: doc.id, templateType, fileName, document: doc };
    }

    templateUiMetaNotFoundError(`UI meta not found for id ${normalizedId}`);
  }

  async getUiMetaByTemplateType(templateTypeRaw: string): Promise<TemplateUiMetaGetResult> {
    const templateType = normalizeTemplateUiMetaType(templateTypeRaw);
    if (!templateType) {
      templateUiMetaValidationError(
        `Invalid templateType. Allowed: ${TEMPLATE_UI_META_TYPES.join(', ')}`,
      );
    }

    for (const fileName of candidateUiMetaFileNames(templateType)) {
      const fullPath = path.join(this.baseDir, fileName);
      if (!existsSync(fullPath)) continue;
      const raw = await readFile(fullPath, 'utf-8');
      const doc = parseUiMetaDocument(raw, fileName);
      return { metaId: doc.id, templateType, fileName, document: doc };
    }

    templateUiMetaNotFoundError(`UI meta file not found for template type ${templateType}`);
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
      templateUiMetaValidationError(
        `Invalid templateType. Allowed: ${TEMPLATE_UI_META_TYPES.join(', ')}`,
      );
    }

    const document = assertUiMetaUpsertBody(body);
    const expectedType = resolveTemplateTypeForMetaId(document.id);
    const typeMatches =
      !expectedType ||
      expectedType === templateType ||
      (expectedType === 'ALERT_POLICY' && templateType === 'ALERT');
    if (!typeMatches) {
      templateUiMetaValidationError(
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
}
