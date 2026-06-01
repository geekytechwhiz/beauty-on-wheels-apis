import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ORG_CONFIG_META_FILE } from '../constants/org-config-meta.constants';
import { UI_META_CANONICAL_FILE } from '../constants/template-ui-meta.constants';
import { templateUiMetaValidationError } from './template-ui-meta.utils';

export const UI_META_REGISTRY_FILE = 'ui-meta-registry.json';
export const ORG_CONFIG_REGISTRY_FILE = 'org-config-meta-registry.json';

const SKIP_SCAN_FILE_NAMES = new Set([
  UI_META_REGISTRY_FILE,
  ORG_CONFIG_REGISTRY_FILE,
]);

const BUILTIN_ORG_CONFIG_FILE_NAMES = new Set(Object.values(ORG_CONFIG_META_FILE));

export type MetaRegistryMap = Record<string, string>;

export function normalizeMetaRegistryKey(raw: string): string | undefined {
  const key = raw.trim().toUpperCase().replace(/-/g, '_');
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) {
    return undefined;
  }
  return key;
}

export function templateTypeToSlug(templateType: string): string {
  return templateType.trim().toLowerCase().replace(/_/g, '-');
}

export function defaultUiMetaFileName(templateType: string): string {
  return `${templateTypeToSlug(templateType)}-api-response.json`;
}

export function defaultOrgConfigFileName(configKey: string): string {
  return `org-config-${templateTypeToSlug(configKey)}.json`;
}

export function assertSafeJsonFileName(fileName: string): string {
  const name = fileName.trim();
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    templateUiMetaValidationError('fileName must be a single .json file name without path segments');
  }
  if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name)) {
    templateUiMetaValidationError('fileName must match pattern name.json');
  }
  return name;
}

export function isMetaRegistryFileName(fileName: string): boolean {
  return SKIP_SCAN_FILE_NAMES.has(fileName);
}

export function isBuiltinOrgConfigFileName(fileName: string): boolean {
  return BUILTIN_ORG_CONFIG_FILE_NAMES.has(fileName);
}

export async function readUiMetaRegistry(baseDir: string): Promise<MetaRegistryMap> {
  return readRegistryFile(baseDir, UI_META_REGISTRY_FILE);
}

export async function readOrgConfigRegistry(baseDir: string): Promise<MetaRegistryMap> {
  return readRegistryFile(baseDir, ORG_CONFIG_REGISTRY_FILE);
}

async function readRegistryFile(baseDir: string, registryFileName: string): Promise<MetaRegistryMap> {
  const registryPath = path.join(baseDir, registryFileName);
  if (!existsSync(registryPath)) {
    return {};
  }
  try {
    const raw = await readFile(registryPath, 'utf-8');
    const parsed = JSON.parse(raw) as { entries?: MetaRegistryMap };
    if (!parsed?.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
      return {};
    }
    const entries: MetaRegistryMap = {};
    for (const [key, fileName] of Object.entries(parsed.entries)) {
      const normalizedKey = normalizeMetaRegistryKey(key);
      if (!normalizedKey || typeof fileName !== 'string' || !fileName.trim()) continue;
      entries[normalizedKey] = assertSafeJsonFileName(fileName);
    }
    return entries;
  } catch {
    return {};
  }
}

async function writeRegistryEntry(
  baseDir: string,
  registryFileName: string,
  key: string,
  fileName: string,
): Promise<void> {
  const normalizedKey = normalizeMetaRegistryKey(key);
  if (!normalizedKey) {
    templateUiMetaValidationError('Registry key must be uppercase letters, digits, and underscores');
  }
  const safeFileName = assertSafeJsonFileName(fileName);
  const existing = await readRegistryFile(baseDir, registryFileName);
  existing[normalizedKey] = safeFileName;
  const registryPath = path.join(baseDir, registryFileName);
  await writeFile(
    registryPath,
    `${JSON.stringify({ version: 1, entries: existing }, null, 2)}\n`,
    'utf-8',
  );
}

export async function registerUiMetaFile(
  baseDir: string,
  templateType: string,
  fileName: string,
): Promise<void> {
  const key = normalizeMetaRegistryKey(templateType);
  if (!key) {
    templateUiMetaValidationError('templateType must be uppercase letters, digits, and underscores');
  }
  await writeRegistryEntry(baseDir, UI_META_REGISTRY_FILE, key, fileName);
}

export async function registerOrgConfigFile(
  baseDir: string,
  configKey: string,
  fileName: string,
): Promise<void> {
  const key = normalizeMetaRegistryKey(configKey);
  if (!key) {
    templateUiMetaValidationError('configKey must be uppercase letters, digits, and underscores');
  }
  await writeRegistryEntry(baseDir, ORG_CONFIG_REGISTRY_FILE, key, fileName);
}

export async function resolveUiMetaFileName(
  baseDir: string,
  templateTypeRaw: string,
): Promise<{ templateType: string; fileName: string }> {
  const templateType = normalizeMetaRegistryKey(templateTypeRaw);
  if (!templateType) {
    templateUiMetaValidationError('templateType must be uppercase letters, digits, and underscores');
  }

  const known = UI_META_CANONICAL_FILE[templateType as keyof typeof UI_META_CANONICAL_FILE];
  if (known) {
    return { templateType, fileName: known };
  }

  const registry = await readUiMetaRegistry(baseDir);
  if (registry[templateType]) {
    return { templateType, fileName: registry[templateType] };
  }

  return { templateType, fileName: defaultUiMetaFileName(templateType) };
}

export async function resolveOrgConfigFileName(
  baseDir: string,
  configKeyRaw: string,
): Promise<{ configKey: string; fileName: string }> {
  const normalized = configKeyRaw.trim().toUpperCase().replace(/-/g, '_');
  const aliasKey =
    normalized === 'ORG_MANAGEIBILITY' ? 'ORG_MANAGEABILITY' : normalized;
  const configKey = normalizeMetaRegistryKey(aliasKey);
  if (!configKey) {
    templateUiMetaValidationError('configKey must be uppercase letters, digits, and underscores');
  }

  const builtin = ORG_CONFIG_META_FILE[configKey as keyof typeof ORG_CONFIG_META_FILE];
  if (builtin) {
    return { configKey, fileName: builtin };
  }

  const registry = await readOrgConfigRegistry(baseDir);
  if (registry[configKey]) {
    return { configKey, fileName: registry[configKey] };
  }

  return { configKey, fileName: defaultOrgConfigFileName(configKey) };
}

export async function collectOrgConfigFileNames(baseDir: string): Promise<Set<string>> {
  const names = new Set(BUILTIN_ORG_CONFIG_FILE_NAMES);
  const registry = await readOrgConfigRegistry(baseDir);
  for (const fileName of Object.values(registry)) {
    names.add(fileName);
  }
  return names;
}

export function templateUiMetaConflictError(message: string): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 409;
  err.code = 'CONFLICT';
  throw err;
}
