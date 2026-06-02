import { existsSync } from 'node:fs';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  normalizeTemplateUiMetaType,
  resolveTemplateTypeForMetaId,
  TEMPLATE_UI_META_TYPES,
  UI_META_LEGACY_FILES,
} from '../constants/template-ui-meta.constants';
import type { TemplateUiMetaGetResult, TemplateUiMetaListItem } from '../models/api/template-ui-meta.types';
import {
  assertSafeJsonFileName,
  isMetaRegistryFileName,
  normalizeMetaRegistryKey,
  readUiMetaRegistry,
  registerUiMetaFile,
  resolveUiMetaFileName,
  templateUiMetaConflictError,
} from '../utils/meta-registry.utils';
import {
  assertCreateUiMetaBody,
  assertUiMetaUpsertBody,
  candidateUiMetaFileNames,
  isOrgConfigMetaFileName,
  parseUiMetaDocument,
  prepareServicesJsonDir,
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
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const orgConfigFiles = await this.loadOrgConfigFileNames(baseDir);
    const entries = await readdir(baseDir, { withFileTypes: true });
    const items: TemplateUiMetaListItem[] = [];
    const seenIds = new Set<string>();

    for (const templateType of TEMPLATE_UI_META_TYPES) {
      for (const fileName of candidateUiMetaFileNames(templateType)) {
        await this.tryAddListItem(baseDir, fileName, templateType, items, seenIds, orgConfigFiles);
      }
    }

    const registry = await readUiMetaRegistry(baseDir);
    for (const [templateType, fileName] of Object.entries(registry)) {
      await this.tryAddListItem(baseDir, fileName, templateType, items, seenIds, orgConfigFiles);
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      if (isMetaRegistryFileName(entry.name) || isOrgConfigMetaFileName(entry.name, orgConfigFiles)) {
        continue;
      }
      await this.tryAddListItem(baseDir, entry.name, undefined, items, seenIds, orgConfigFiles);
    }

    return items;
  }

  async getUiMetaById(metaId: string): Promise<TemplateUiMetaGetResult> {
    const normalizedId = metaId.trim();
    if (!normalizedId) {
      templateUiMetaValidationError('metaId is required');
    }

    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const registry = await readUiMetaRegistry(baseDir);
    const typeKey = normalizeMetaRegistryKey(normalizedId);
    if (
      typeKey &&
      ((TEMPLATE_UI_META_TYPES as readonly string[]).includes(typeKey) || registry[typeKey])
    ) {
      try {
        return await this.getUiMetaByTemplateType(typeKey);
      } catch (e: unknown) {
        if (
          e &&
          typeof e === 'object' &&
          'statusCode' in e &&
          (e as { statusCode: number }).statusCode === 404
        ) {
          // continue scan by document id
        } else {
          throw e;
        }
      }
    }

    const orgConfigFiles = await this.loadOrgConfigFileNames(baseDir);
    const entries = await readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fileName = entry.name;
      if (isMetaRegistryFileName(fileName) || isOrgConfigMetaFileName(fileName, orgConfigFiles)) {
        continue;
      }

      const fullPath = path.join(baseDir, fileName);
      try {
        const raw = await readFile(fullPath, 'utf-8');
        const doc = parseUiMetaDocument(raw, fileName);
        if (doc.id !== normalizedId) continue;

        const templateType =
          resolveTemplateTypeForUiMetaDocument(doc, fileName) ??
          templateTypeFromRegistry(fileName, registry) ??
          resolveTemplateTypeForMetaId(doc.id);
        if (!templateType) {
          templateUiMetaValidationError(`Could not resolve template type for id ${normalizedId}`);
        }

        return { metaId: doc.id, templateType, fileName, document: doc };
      } catch (e: unknown) {
        if (
          e &&
          typeof e === 'object' &&
          'statusCode' in e &&
          (e as { statusCode: number }).statusCode === 400
        ) {
          continue;
        }
        throw e;
      }
    }

    templateUiMetaNotFoundError(`UI meta not found for id ${normalizedId}`);
  }

  async getUiMetaByTemplateType(templateTypeRaw: string): Promise<TemplateUiMetaGetResult> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const { templateType, fileName } = await resolveUiMetaFileName(baseDir, templateTypeRaw);

    const candidates = new Set<string>([fileName]);
    if ((TEMPLATE_UI_META_TYPES as readonly string[]).includes(templateType)) {
      for (const legacyName of candidateUiMetaFileNames(
        templateType as (typeof TEMPLATE_UI_META_TYPES)[number],
      )) {
        candidates.add(legacyName);
      }
    }
    for (const candidate of candidates) {
      const fullPath = path.join(baseDir, candidate);
      if (!existsSync(fullPath)) continue;
      const raw = await readFile(fullPath, 'utf-8');
      const doc = parseUiMetaDocument(raw, candidate);
      return { metaId: doc.id, templateType, fileName: candidate, document: doc };
    }

    templateUiMetaNotFoundError(`UI meta file not found for template type ${templateType}`);
  }

  /**
   * Create template UI meta for any template type (including new types such as CARE_PLAN).
   * Returns 409 when the target file or meta id already exists.
   */
  async createUiMeta(body: unknown): Promise<TemplateUiMetaGetResult> {
    const { templateType: templateTypeRaw, fileName: fileNameOverride, document } =
      assertCreateUiMetaBody(body);
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const { templateType, fileName: resolvedDefault } = await resolveUiMetaFileName(
      baseDir,
      templateTypeRaw,
    );
    const fileName = fileNameOverride
      ? assertSafeJsonFileName(fileNameOverride)
      : resolvedDefault;

    this.assertIdMatchesTemplateType(document.id, templateType);

    const targetPath = path.join(baseDir, fileName);
    if (existsSync(targetPath)) {
      templateUiMetaConflictError(
        `UI meta file already exists for template type ${templateType} (${fileName})`,
      );
    }

    if (await this.metaIdExists(baseDir, document.id)) {
      templateUiMetaConflictError(`UI meta id "${document.id}" already exists`);
    }

    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    await registerUiMetaFile(baseDir, templateType, fileName);

    return { metaId: document.id, templateType, fileName, document };
  }

  /**
   * Update existing template UI meta for a template type.
   * Returns 404 when no file exists for the type.
   */
  async updateUiMeta(templateTypeRaw: string, body: unknown): Promise<TemplateUiMetaGetResult> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const { templateType, fileName } = await resolveUiMetaFileName(baseDir, templateTypeRaw);
    const document = assertUiMetaUpsertBody(body);
    this.assertIdMatchesTemplateType(document.id, templateType);

    const targetPath = path.join(baseDir, fileName);
    if (!existsSync(targetPath)) {
      templateUiMetaNotFoundError(`UI meta file not found for template type ${templateType}`);
    }

    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    await registerUiMetaFile(baseDir, templateType, fileName);

    for (const legacyName of UI_META_LEGACY_FILES[templateType as keyof typeof UI_META_LEGACY_FILES] ?? []) {
      const legacyPath = path.join(baseDir, legacyName);
      if (legacyPath !== targetPath && existsSync(legacyPath)) {
        await unlink(legacyPath);
      }
    }

    return { metaId: document.id, templateType, fileName, document };
  }

  /** @deprecated Use {@link createUiMeta} or {@link updateUiMeta}. */
  async upsertUiMeta(templateTypeRaw: string, body: unknown): Promise<TemplateUiMetaGetResult> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const { fileName } = await resolveUiMetaFileName(baseDir, templateTypeRaw);
    if (existsSync(path.join(baseDir, fileName))) {
      return this.updateUiMeta(templateTypeRaw, body);
    }
    const document = assertUiMetaUpsertBody(body);
    return this.createUiMeta({
      templateType: templateTypeRaw,
      ...document,
    });
  }

  private assertIdMatchesTemplateType(metaId: string, templateType: string): void {
    const expectedType = resolveTemplateTypeForMetaId(metaId);
    const typeMatches =
      !expectedType ||
      expectedType === templateType ||
      (expectedType === 'ALERT_POLICY' && templateType === 'ALERT') ||
      (expectedType === 'ALERT_POLICY' && templateType === 'ALERT_POLICY');
    if (!typeMatches) {
      templateUiMetaValidationError(
        `meta id "${metaId}" does not match template type ${templateType}`,
      );
    }
  }

  private async metaIdExists(baseDir: string, metaId: string): Promise<boolean> {
    try {
      await this.getUiMetaById(metaId);
      return true;
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'statusCode' in e &&
        (e as { statusCode: number }).statusCode === 404
      ) {
        return false;
      }
      throw e;
    }
  }

  private async loadOrgConfigFileNames(baseDir: string): Promise<Set<string>> {
    const { collectOrgConfigFileNames } = await import('../utils/meta-registry.utils');
    return collectOrgConfigFileNames(baseDir);
  }

  private async tryAddListItem(
    baseDir: string,
    fileName: string,
    templateTypeHint: string | undefined,
    items: TemplateUiMetaListItem[],
    seenIds: Set<string>,
    orgConfigFiles: Set<string>,
  ): Promise<void> {
    if (isMetaRegistryFileName(fileName) || isOrgConfigMetaFileName(fileName, orgConfigFiles)) {
      return;
    }
    const fullPath = path.join(baseDir, fileName);
    if (!existsSync(fullPath)) return;
    try {
      const raw = await readFile(fullPath, 'utf-8');
      const doc = parseUiMetaDocument(raw, fileName);
      if (seenIds.has(doc.id)) return;
      const templateType =
        templateTypeHint ??
        resolveTemplateTypeForUiMetaDocument(doc, fileName) ??
        templateTypeFromRegistry(fileName, await readUiMetaRegistry(baseDir));
      if (!templateType) return;
      seenIds.add(doc.id);
      items.push({ templateType, metaId: doc.id, fileName, document: doc });
    } catch {
      // skip unreadable files in list
    }
  }
}

function templateTypeFromRegistry(
  fileName: string,
  registry: Record<string, string>,
): string | undefined {
  for (const [templateType, mappedFile] of Object.entries(registry)) {
    if (mappedFile === fileName) return templateType;
  }
  return undefined;
}
