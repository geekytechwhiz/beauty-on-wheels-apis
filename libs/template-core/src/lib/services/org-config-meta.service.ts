import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  normalizeOrgConfigMetaKey,
  ORG_CONFIG_META_FILE,
  ORG_CONFIG_META_KEYS,
  type OrgConfigMetaKey,
} from '../constants/org-config-meta.constants';
import { prepareServicesJsonDir, resolveServicesJsonDir } from '../utils/template-ui-meta.utils';

export type OrgConfigMetaDocument = Record<string, unknown> & {
  active: boolean;
  version: number;
};

export type OrgConfigMetaListItem = {
  configKey: OrgConfigMetaKey;
  fileName: string;
  document: OrgConfigMetaDocument;
};

export type OrgConfigMetaGetResult = {
  configKey: OrgConfigMetaKey;
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

export class OrgConfigMetaService {
  constructor(private readonly baseDir = resolveServicesJsonDir()) {}

  async listOrgConfigMeta(): Promise<OrgConfigMetaListItem[]> {
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const items: OrgConfigMetaListItem[] = [];

    for (const configKey of ORG_CONFIG_META_KEYS) {
      const fileName = ORG_CONFIG_META_FILE[configKey];
      const fullPath = path.join(baseDir, fileName);
      if (!existsSync(fullPath)) continue;
      const raw = await readFile(fullPath, 'utf-8');
      const document = parseOrgConfigDocument(raw, fileName);
      items.push({ configKey, fileName, document });
    }

    return items;
  }

  async getOrgConfigMetaByKey(configKeyRaw: string): Promise<OrgConfigMetaGetResult> {
    const configKey = normalizeOrgConfigMetaKey(configKeyRaw);
    if (!configKey) {
      validationError(
        `Invalid configKey. Allowed: ${ORG_CONFIG_META_KEYS.join(', ')} (alias: ORG_MANAGEIBILITY)`,
      );
    }

    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const fileName = ORG_CONFIG_META_FILE[configKey];
    const fullPath = path.join(baseDir, fileName);
    if (!existsSync(fullPath)) {
      notFoundError(`Org config not found for key ${configKey}`);
    }

    const raw = await readFile(fullPath, 'utf-8');
    const document = parseOrgConfigDocument(raw, fileName);
    return { configKey, fileName, document };
  }

  /**
   * Create or update org config JSON (ORG_DRAWER, ORG_MANAGEABILITY, ENABLE_SCOPE).
   * Ensures `active` (default true) and `version` (default 1, or increment when omitted on update).
   */
  async upsertOrgConfigMeta(
    configKeyRaw: string,
    body: unknown,
  ): Promise<OrgConfigMetaGetResult> {
    const configKey = normalizeOrgConfigMetaKey(configKeyRaw);
    if (!configKey) {
      validationError(
        `Invalid configKey. Allowed: ${ORG_CONFIG_META_KEYS.join(', ')} (alias: ORG_MANAGEIBILITY)`,
      );
    }

    const payload = assertUpsertBody(body);
    const baseDir = await prepareServicesJsonDir(this.baseDir);
    const fileName = ORG_CONFIG_META_FILE[configKey];
    const targetPath = path.join(baseDir, fileName);

    let existingVersion: number | undefined;
    if (existsSync(targetPath)) {
      try {
        const existingRaw = await readFile(targetPath, 'utf-8');
        const existing = parseOrgConfigDocument(existingRaw, fileName);
        existingVersion = existing.version;
      } catch {
        existingVersion = undefined;
      }
    }

    const document = normalizeOrgConfigFields(payload, existingVersion);
    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');

    return { configKey, fileName, document };
  }
}
