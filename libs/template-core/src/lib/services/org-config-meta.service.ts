import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ORG_CONFIG_META_FILE,
  ORG_CONFIG_META_KEYS,
  type OrgConfigMetaKey,
} from '../constants/org-config-meta.constants';
import {
  assertSafeJsonFileName,
  collectOrgConfigFileNames,
  isMetaRegistryFileName,
  readOrgConfigRegistry,
  registerOrgConfigFile,
  resolveOrgConfigFileName,
  templateUiMetaConflictError,
} from '../utils/meta-registry.utils';
import { prepareServicesJsonDir, resolveServicesJsonDir } from '../utils/template-ui-meta.utils';

export type OrgConfigMetaDocument = Record<string, unknown> & {
  active: boolean;
  version: number;
};

export type OrgConfigMetaListItem = {
  configKey: string;
  fileName: string;
  document: OrgConfigMetaDocument;
};

export type OrgConfigMetaGetResult = {
  configKey: string;
  fileName: string;
  document: OrgConfigMetaDocument;
};

function validationError(message: string): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  throw err;
}

function notFoundError(message = 'Org config meta not found'): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 404;
  err.code = 'NOT_FOUND';
  throw err;
}

function parseOrgConfigDocument(raw: string, fileName: string): OrgConfigMetaDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    validationError(`Invalid JSON in ${fileName}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    validationError(`Org config root must be an object (${fileName})`);
  }
  return normalizeOrgConfigFields(parsed as Record<string, unknown>);
}

function normalizeOrgConfigFields(
  doc: Record<string, unknown>,
  existingVersion?: number,
): OrgConfigMetaDocument {
  const active = typeof doc.active === 'boolean' ? doc.active : true;
  let version: number;
  if (typeof doc.version === 'number' && Number.isInteger(doc.version) && doc.version >= 1) {
    version = doc.version;
  } else if (existingVersion !== undefined) {
    version = existingVersion + 1;
  } else {
    version = 1;
  }
  return { ...doc, active, version } as OrgConfigMetaDocument;
}

function assertUpsertBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    validationError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export type CreateOrgConfigMetaBody = {
  configKey: string;
  fileName?: string;
  payload: Record<string, unknown>;
};

function assertCreateOrgConfigBody(body: unknown): CreateOrgConfigMetaBody {
  const payload = assertUpsertBody(body);
  const configKey =
    typeof payload.configKey === 'string' ? payload.configKey.trim() : '';
  if (!configKey) {
    validationError('configKey is required');
  }
  const fileName =
    typeof payload.fileName === 'string' && payload.fileName.trim()
      ? payload.fileName.trim()
      : undefined;
  const { configKey: _k, fileName: _f, ...rest } = payload;
  return { configKey, fileName, payload: rest };
}

export class OrgConfigMetaService {
  constructor(private readonly baseDir = resolveServicesJsonDir()) {}

  async listOrgConfigMeta(): Promise<OrgConfigMetaListItem[]> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const items: OrgConfigMetaListItem[] = [];
    const seenKeys = new Set<string>();

    for (const configKey of ORG_CONFIG_META_KEYS) {
      await this.tryAddListItem(baseDir, configKey, items, seenKeys);
    }

    const registry = await readOrgConfigRegistry(baseDir);
    for (const configKey of Object.keys(registry)) {
      await this.tryAddListItem(baseDir, configKey, items, seenKeys);
    }

    const orgFiles = await collectOrgConfigFileNames(baseDir);
    const entries = await readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      if (!orgFiles.has(entry.name) || isMetaRegistryFileName(entry.name)) continue;
      const configKey = configKeyFromRegistry(entry.name, registry);
      if (!configKey || seenKeys.has(configKey)) continue;
      await this.tryAddListItem(baseDir, configKey, items, seenKeys);
    }

    return items;
  }

  async getOrgConfigMetaByKey(configKeyRaw: string): Promise<OrgConfigMetaGetResult> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const { configKey, fileName } = await resolveOrgConfigFileName(baseDir, configKeyRaw);
    const fullPath = path.join(baseDir, fileName);
    if (!existsSync(fullPath)) {
      notFoundError(`Org config not found for key ${configKey}`);
    }

    const raw = await readFile(fullPath, 'utf-8');
    const document = parseOrgConfigDocument(raw, fileName);
    return { configKey, fileName, document };
  }

  /**
   * Create org config meta for any config key (built-in or custom).
   * Returns 409 when the target file already exists.
   */
  async createOrgConfigMeta(body: unknown): Promise<OrgConfigMetaGetResult> {
    const { configKey: configKeyRaw, fileName: fileNameOverride, payload } =
      assertCreateOrgConfigBody(body);
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const { configKey, fileName: resolvedDefault } = await resolveOrgConfigFileName(
      baseDir,
      configKeyRaw,
    );
    const fileName = fileNameOverride
      ? assertSafeJsonFileName(fileNameOverride)
      : resolvedDefault;
    const targetPath = path.join(baseDir, fileName);

    if (existsSync(targetPath)) {
      templateUiMetaConflictError(
        `Org config file already exists for key ${configKey} (${fileName})`,
      );
    }

    const document = normalizeOrgConfigFields(payload);
    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    await registerOrgConfigFile(baseDir, configKey, fileName);

    return { configKey, fileName, document };
  }

  /**
   * Update existing org config meta. Returns 404 when the file does not exist.
   */
  async updateOrgConfigMeta(
    configKeyRaw: string,
    body: unknown,
  ): Promise<OrgConfigMetaGetResult> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const resolved = await resolveOrgConfigFileName(baseDir, configKeyRaw);
    const fileName = resolved.fileName;
    const targetPath = path.join(baseDir, fileName);

    if (!existsSync(targetPath)) {
      notFoundError(`Org config not found for key ${resolved.configKey}`);
    }

    const payload = assertUpsertBody(body);
    let existingVersion: number | undefined;
    try {
      const existingRaw = await readFile(targetPath, 'utf-8');
      const existing = parseOrgConfigDocument(existingRaw, fileName);
      existingVersion = existing.version;
    } catch {
      existingVersion = undefined;
    }

    const document = normalizeOrgConfigFields(payload, existingVersion);
    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    await registerOrgConfigFile(baseDir, resolved.configKey, fileName);

    return { configKey: resolved.configKey, fileName, document };
  }

  /** @deprecated Use {@link createOrgConfigMeta} or {@link updateOrgConfigMeta}. */
  async upsertOrgConfigMeta(
    configKeyRaw: string,
    body: unknown,
  ): Promise<OrgConfigMetaGetResult> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const { fileName } = await resolveOrgConfigFileName(baseDir, configKeyRaw);
    if (existsSync(path.join(baseDir, fileName))) {
      return this.updateOrgConfigMeta(configKeyRaw, body);
    }
    return this.createOrgConfigMeta({ configKey: configKeyRaw, ...assertUpsertBody(body) });
  }

  private async tryAddListItem(
    baseDir: string,
    configKey: string,
    items: OrgConfigMetaListItem[],
    seenKeys: Set<string>,
  ): Promise<void> {
    if (seenKeys.has(configKey)) return;
    try {
      const result = await this.getOrgConfigMetaByKey(configKey);
      seenKeys.add(configKey);
      items.push({
        configKey: result.configKey,
        fileName: result.fileName,
        document: result.document,
      });
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'statusCode' in e &&
        (e as { statusCode: number }).statusCode === 404
      ) {
        return;
      }
      throw e;
    }
  }
}

function configKeyFromRegistry(
  fileName: string,
  registry: Record<string, string>,
): string | undefined {
  for (const [configKey, mappedFile] of Object.entries(registry)) {
    if (mappedFile === fileName) return configKey;
  }
  for (const key of ORG_CONFIG_META_KEYS) {
    if (ORG_CONFIG_META_FILE[key as OrgConfigMetaKey] === fileName) return key;
  }
  if (fileName.startsWith('org-config-') && fileName.endsWith('.json')) {
    const slug = fileName.slice('org-config-'.length, -'.json'.length);
    return slug.toUpperCase().replace(/-/g, '_');
  }
  return undefined;
}
