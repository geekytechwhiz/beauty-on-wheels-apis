import yaml from 'js-yaml';

export type SpecFileExtension = 'json' | 'yaml' | 'yml';
export type VersionBumpType = 'major' | 'minor' | 'patch';
export type SpecReviewStatus = 'pending' | 'approved' | 'rejected';

const SPEC_REVIEW_STATUS_FIELD = 'x-api-center-status';

interface ParsedSemanticVersion {
  prefix: string;
  major: number;
  minor: number;
  patch: number;
}

export interface OpenApiSpecFile {
  serviceName: string;
  version: string;
  key: string;
  extension: SpecFileExtension;
  contentType: string;
  status: SpecReviewStatus;
  lastModified?: string;
  size?: number;
}

export interface ServiceCatalogEntry {
  name: string;
  latestVersion: string;
  versions: OpenApiSpecFile[];
}

export interface UploadSpecInput {
  serviceName: string;
  version: string;
  file: File;
}

export interface DeleteSpecVersionInput {
  serviceName: string;
  version: string;
  key?: string;
}

export interface ValidatedOpenApiFile {
  parsedSpec: Record<string, unknown>;
  normalizedText: string;
  extension: SpecFileExtension;
  contentType: string;
}

export interface EditableSpecDocument {
  serviceName: string;
  version: string;
  key: string;
  yamlText: string;
  parsedSpec: Record<string, unknown>;
}

export interface SaveEditedSpecInput {
  serviceName: string;
  version: string;
  yamlText: string;
}

export interface DesignLibraryEntry {
  name: string;
  description: string;
  figmaUrl: string;
  updatedAt?: string;
}

interface PublicCatalogIndex {
  generatedAt: string;
  services: ServiceCatalogEntry[];
}

const DEFAULT_SPECS_PREFIX = 'specs-store';
const DEFAULT_SPEC_REVIEW_STATUS: SpecReviewStatus = 'approved';
const OPENAPI_FILE_PATTERN = /^(.+?)\/(.+?)\/openapi\.(json|yaml|yml)$/i;
const VERSION_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});
const SEMVER_PATTERN = /^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i;

/** Dev/preview-only JSON API mount (not the same path as static `public/{specsPrefix}/`). */
const LOCAL_SPEC_API = '/__api-center/specs-store';

function getSpecsPrefix(): string {
  const rawPrefix = import.meta.env.VITE_SPECS_PREFIX?.trim();
  if (!rawPrefix) {
    return DEFAULT_SPECS_PREFIX;
  }
  return rawPrefix.replace(/^\/+|\/+$/g, '');
}

/** Base URL for static assets (figma JSON) served with the SPA. */
function publicAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const trimmed = relativePath.replace(/^\/+/, '');
  return `${base}${trimmed}`;
}

export function getCatalogSummary(): {
  specsPrefix: string;
  indexKey: string;
  localWriteEnabled: boolean;
} {
  const specsPrefix = getSpecsPrefix();
  return {
    specsPrefix,
    indexKey: `${LOCAL_SPEC_API}/catalog`,
    localWriteEnabled: canWriteSpecsLocally(),
  };
}

/** Dev server local API for writing into `public/specs-store` (see vite plugin). */
export function canWriteSpecsLocally(): boolean {
  return true;
}

function withCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}ts=${Date.now()}`;
}

async function fetchPublicText(url: string, options?: { cacheBust?: boolean }): Promise<string> {
  const response = await fetch(options?.cacheBust ? withCacheBust(url) : url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json, application/yaml, text/yaml, text/plain, application/xml, text/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to load ${url}. Received ${response.status} ${response.statusText}.`);
  }

  return response.text();
}

function normalizeSegment(value: string, label: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.includes('/')) {
    throw new Error(`${label} cannot contain "/".`);
  }
  return normalized;
}

function getContentType(extension: SpecFileExtension): string {
  switch (extension) {
    case 'json':
      return 'application/json';
    case 'yaml':
    case 'yml':
      return 'application/yaml';
  }
}

function getObjectKeyWithoutPrefix(key: string): string | null {
  const prefix = `${getSpecsPrefix()}/`;
  if (!key.startsWith(prefix)) {
    return null;
  }
  return key.slice(prefix.length);
}

function parseSpecFileKey(
  key: string,
  options?: {
    lastModified?: string;
    size?: number;
    status?: SpecReviewStatus;
  },
): OpenApiSpecFile | null {
  const relativeKey = getObjectKeyWithoutPrefix(key);
  if (!relativeKey) {
    return null;
  }

  const match = relativeKey.match(OPENAPI_FILE_PATTERN);
  if (!match) {
    return null;
  }

  const [, rawServiceName, rawVersion, rawExtension] = match;
  const extension = rawExtension.toLowerCase() as SpecFileExtension;

  return {
    serviceName: rawServiceName,
    version: rawVersion,
    key,
    extension,
    contentType: getContentType(extension),
    status: options?.status ?? DEFAULT_SPEC_REVIEW_STATUS,
    lastModified: options?.lastModified,
    size: options?.size,
  };
}

function normalizeSpecReviewStatus(value: string | undefined): SpecReviewStatus {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}

export function serializeSpecWithStatus(
  parsedSpec: Record<string, unknown>,
  extension: SpecFileExtension,
  status: SpecReviewStatus,
): string {
  const nextSpec = {
    ...parsedSpec,
    [SPEC_REVIEW_STATUS_FIELD]: status,
  };

  if (extension === 'json') {
    return JSON.stringify(nextSpec, null, 2);
  }

  return normalizeSpecToYaml(nextSpec);
}

function compareVersionsDesc(left: string, right: string): number {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);

  if (parsedLeft && parsedRight) {
    if (parsedLeft.major !== parsedRight.major) {
      return parsedRight.major - parsedLeft.major;
    }
    if (parsedLeft.minor !== parsedRight.minor) {
      return parsedRight.minor - parsedLeft.minor;
    }
    if (parsedLeft.patch !== parsedRight.patch) {
      return parsedRight.patch - parsedLeft.patch;
    }
  }

  return VERSION_COLLATOR.compare(right, left);
}

function parseSemanticVersion(version: string): ParsedSemanticVersion | null {
  const normalizedVersion = version.trim();
  const match = normalizedVersion.match(SEMVER_PATTERN);
  if (!match) {
    return null;
  }

  const [, prefix, major, minor, patch] = match;
  return {
    prefix,
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor ?? '0', 10),
    patch: Number.parseInt(patch ?? '0', 10),
  };
}

function formatSemanticVersion(version: ParsedSemanticVersion): string {
  return `${version.prefix}${version.major}.${version.minor}.${version.patch}`;
}

export function parseOpenApiText(
  rawText: string,
  extension: SpecFileExtension = 'yaml',
): Record<string, unknown> {
  const parsedSpec: unknown =
    extension === 'json' ? JSON.parse(rawText) : yaml.load(rawText);

  if (!parsedSpec || typeof parsedSpec !== 'object' || Array.isArray(parsedSpec)) {
    throw new Error('The OpenAPI document must be a YAML or JSON object.');
  }

  return parsedSpec as Record<string, unknown>;
}

export function normalizeSpecToYaml(parsedSpec: Record<string, unknown>): string {
  return yaml.dump(parsedSpec, {
    noRefs: true,
    lineWidth: 120,
  });
}

export function computeNextVersion(
  latestVersion: string | null,
  bumpType: VersionBumpType,
): string {
  const parsedLatestVersion = latestVersion
    ? parseSemanticVersion(latestVersion)
    : {
        prefix: 'v',
        major: 0,
        minor: 0,
        patch: 0,
      };

  if (!parsedLatestVersion) {
    throw new Error(
      `The latest version "${latestVersion}" is not semantic. Rename it to a semantic version before using automatic increments.`,
    );
  }

  const nextVersion: ParsedSemanticVersion = { ...parsedLatestVersion };
  switch (bumpType) {
    case 'major':
      nextVersion.major += 1;
      nextVersion.minor = 0;
      nextVersion.patch = 0;
      break;
    case 'minor':
      nextVersion.minor += 1;
      nextVersion.patch = 0;
      break;
    case 'patch':
      nextVersion.patch += 1;
      break;
  }

  return formatSemanticVersion(nextVersion);
}

export function getNextVersionForService(
  service: ServiceCatalogEntry | null | undefined,
  bumpType: VersionBumpType,
): string {
  return computeNextVersion(service?.latestVersion ?? null, bumpType);
}

function normalizeCatalog(services: ServiceCatalogEntry[]): ServiceCatalogEntry[] {
  return services
    .map((service) => {
      const grouped = new Map<string, OpenApiSpecFile>();

      for (const version of service.versions) {
        const normalized = parseSpecFileKey(version.key, {
          lastModified: version.lastModified,
          size: version.size,
          status: version.status,
        });
        if (!normalized) {
          continue;
        }

        const current = grouped.get(normalized.version);
        grouped.set(
          normalized.version,
          current ? pickPreferredFile(current, normalized) : normalized,
        );
      }

      const versions = Array.from(grouped.values()).sort((left, right) =>
        compareVersionsDesc(left.version, right.version),
      );

      return {
        name: service.name,
        latestVersion: versions[0]?.version ?? '',
        versions,
      };
    })
    .filter((service) => service.versions.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function pickPreferredFile(current: OpenApiSpecFile, candidate: OpenApiSpecFile): OpenApiSpecFile {
  if (current.extension === 'json' && candidate.extension !== 'json') {
    return current;
  }
  if (candidate.extension === 'json' && current.extension !== 'json') {
    return candidate;
  }

  const currentModified = current.lastModified ? Date.parse(current.lastModified) : 0;
  const candidateModified = candidate.lastModified ? Date.parse(candidate.lastModified) : 0;
  return candidateModified >= currentModified ? candidate : current;
}

function parseCatalogIndex(rawValue: unknown): PublicCatalogIndex {
  // console.log('rawValue', JSON.stringify(rawValue, null, 2));
  const rawServices = Array.isArray(rawValue)
    ? rawValue
    : rawValue &&
        typeof rawValue === 'object' &&
        'services' in rawValue &&
        Array.isArray((rawValue as { services?: unknown }).services)
      ? (rawValue as { services: unknown[] }).services
      : null;

  if (rawServices === null) {
    throw new Error('Spec catalog index must be a JSON array or an object with a services array.');
  }

  const services = rawServices.flatMap((service): ServiceCatalogEntry[] => {
    if (!service || typeof service !== 'object' || Array.isArray(service)) {
      return [];
    }

    const rawName = 'name' in service ? service.name : undefined;
    const rawVersions = 'versions' in service ? service.versions : undefined;
    if (typeof rawName !== 'string' || !Array.isArray(rawVersions)) {
      return [];
    }

    const versions = rawVersions.flatMap((version): OpenApiSpecFile[] => {
      if (!version || typeof version !== 'object' || Array.isArray(version)) {
        return [];
      }

      const rawKey = 'key' in version ? version.key : undefined;
      if (typeof rawKey !== 'string') {
        return [];
      }

      const parsed = parseSpecFileKey(rawKey, {
        status:
          typeof version.status === 'string'
            ? normalizeSpecReviewStatus(version.status)
            : DEFAULT_SPEC_REVIEW_STATUS,
        lastModified:
          'lastModified' in version && typeof version.lastModified === 'string'
            ? version.lastModified
            : undefined,
        size: 'size' in version && typeof version.size === 'number' ? version.size : undefined,
      });

      return parsed ? [parsed] : [];
    });

    return [
      {
        name: rawName,
        latestVersion:
          typeof service.latestVersion === 'string'
            ? service.latestVersion
            : versions[0]?.version ?? '',
        versions,
      },
    ];
  });

  const generatedAt =
    rawValue &&
    typeof rawValue === 'object' &&
    'generatedAt' in rawValue &&
    typeof rawValue.generatedAt === 'string'
      ? rawValue.generatedAt
      : new Date().toISOString();

  return {
    generatedAt,
    services: normalizeCatalog(services),
  };
}

async function loadCatalogIndex(options?: { allowMissing?: boolean }): Promise<PublicCatalogIndex> {
  try {
    const parsed = await localApiJson<unknown>('/catalog', {
      method: 'GET',
    });
    return parseCatalogIndex(parsed);
  } catch {
    try {
      const text = await fetchPublicText(publicAssetUrl(`${getSpecsPrefix()}/index.json`));
      return parseCatalogIndex(JSON.parse(text) as unknown);
    } catch {
      if (options?.allowMissing) {
        return {
          generatedAt: new Date().toISOString(),
          services: [],
        };
      }
      throw new Error(
        `Unable to load the spec catalog. Tried ${LOCAL_SPEC_API}/catalog and static ${getSpecsPrefix()}/index.json.`,
      );
    }
  }
}

async function localApiJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_SPEC_API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text || `${response.status} ${response.statusText}`;
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      message = j.error ?? j.message ?? message;
    } catch {
      // keep text
    }
    throw new Error(message);
  }
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Expected JSON from ${LOCAL_SPEC_API}${path}, but received non-JSON content.`,
    );
  }
}

function utf8FileToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export async function listServices(): Promise<ServiceCatalogEntry[]> {
  const catalog = await loadCatalogIndex();
  return catalog.services;
}

export async function listVersions(serviceName: string): Promise<OpenApiSpecFile[]> {
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const catalog = await loadCatalogIndex();
  return catalog.services.find((service) => service.name === normalizedServiceName)?.versions ?? [];
}

export async function getLatestVersion(serviceName: string): Promise<string | null> {
  const versions = await listVersions(serviceName);
  return versions[0]?.version ?? null;
}

export async function validateOpenApiFile(file: File): Promise<ValidatedOpenApiFile> {
  const extension = getFileExtension(file.name);
  if (!extension) {
    throw new Error('Only .yaml, .yml, and .json files are supported.');
  }

  const rawText = await file.text();
  try {
    const parsedSpec = parseOpenApiText(rawText, extension);
    const openapiValue = parsedSpec.openapi;
    if (typeof openapiValue !== 'string' || openapiValue.trim() === '') {
      throw new Error('The selected file must include a valid `openapi` version field.');
    }

    const infoValue = parsedSpec.info;
    if (!infoValue || typeof infoValue !== 'object' || Array.isArray(infoValue)) {
      throw new Error('The selected file must include an `info` object.');
    }

    return {
      parsedSpec,
      normalizedText: rawText,
      extension,
      contentType: getContentType(extension),
    };
  } catch (error) {
    throw new Error(
      `Unable to parse the selected file as ${
        extension === 'json' ? 'JSON' : 'YAML'
      }. ${error instanceof Error ? error.message : ''}`.trim(),
    );
  }
}

export async function uploadSpec({
  serviceName,
  version,
  file,
}: UploadSpecInput): Promise<OpenApiSpecFile> {
  if (!canWriteSpecsLocally()) {
    throw new Error('Upload is only available when the local spec API is reachable.');
  }
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(version, 'Version');
  const validatedFile = await validateOpenApiFile(file);
  const contentBase64 = utf8FileToBase64(validatedFile.normalizedText);

  return localApiJson<OpenApiSpecFile>('/upload', {
    method: 'POST',
    body: JSON.stringify({
      serviceName: normalizedServiceName,
      version: normalizedVersion,
      fileName: file.name,
      contentBase64,
    }),
  });
}

async function resolveSpecVersion({
  serviceName,
  version,
}: DeleteSpecVersionInput): Promise<OpenApiSpecFile> {
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(version, 'Version');
  const catalog = await loadCatalogIndex();
  const service = catalog.services.find((item) => item.name === normalizedServiceName);
  const resolved = service?.versions.find((item) => item.version === normalizedVersion);
  if (!resolved) {
    throw new Error(`No OpenAPI spec found for ${serviceName} ${version}.`);
  }
  return resolved;
}

export async function getSpecUrl({
  serviceName,
  version,
}: {
  serviceName: string;
  version: string;
}): Promise<string> {
  const resolved = await resolveSpecVersion({ serviceName, version });
  return publicAssetUrl(resolved.key);
}

export async function loadEditableSpecDocument({
  serviceName,
  version,
}: {
  serviceName: string;
  version: string;
}): Promise<EditableSpecDocument> {
  const resolved = await resolveSpecVersion({ serviceName, version });
  let text: string;
  try {
    const response = await localApiJson<{ extension: SpecFileExtension; text: string }>(
      `/document?serviceName=${encodeURIComponent(resolved.serviceName)}&version=${encodeURIComponent(
        resolved.version,
      )}`,
      {
        method: 'GET',
      },
    );
    text = response.text;
  } catch {
    text = await fetchPublicText(publicAssetUrl(resolved.key));
  }
  const parsedSpec = parseOpenApiText(text, resolved.extension);

  return {
    serviceName: resolved.serviceName,
    version: resolved.version,
    key: resolved.key,
    yamlText: normalizeSpecToYaml(parsedSpec),
    parsedSpec,
  };
}

export async function saveEditedSpecVersion({
  serviceName,
  version,
  yamlText,
}: SaveEditedSpecInput): Promise<OpenApiSpecFile> {
  if (!canWriteSpecsLocally()) {
    throw new Error('Saving is only available when the local spec API is reachable.');
  }
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(version, 'Version');
  const existingVersions = await listVersions(normalizedServiceName);

  if (existingVersions.some((existingVersion) => existingVersion.version === normalizedVersion)) {
    throw new Error(`Version ${normalizedVersion} already exists for ${normalizedServiceName}.`);
  }

  parseOpenApiText(yamlText, 'yaml');

  return localApiJson<OpenApiSpecFile>('/save-edited', {
    method: 'POST',
    body: JSON.stringify({
      serviceName: normalizedServiceName,
      version: normalizedVersion,
      yamlText,
    }),
  });
}

export async function updateSpecReviewStatus({
  serviceName,
  version,
  status,
}: {
  serviceName: string;
  version: string;
  status: SpecReviewStatus;
}): Promise<OpenApiSpecFile> {
  if (!canWriteSpecsLocally()) {
    throw new Error('Status updates are only available when the local spec API is reachable.');
  }
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(version, 'Version');

  return localApiJson<OpenApiSpecFile>('/status', {
    method: 'PATCH',
    body: JSON.stringify({
      serviceName: normalizedServiceName,
      version: normalizedVersion,
      status,
    }),
  });
}

export async function deleteSpecVersion(input: DeleteSpecVersionInput): Promise<void> {
  if (!canWriteSpecsLocally()) {
    throw new Error('Delete is only available when the local spec API is reachable.');
  }
  const normalizedServiceName = normalizeSegment(input.serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(input.version, 'Version');

  await localApiJson('/delete', {
    method: 'POST',
    body: JSON.stringify({
      serviceName: normalizedServiceName,
      version: normalizedVersion,
      key: input.key,
    }),
  });
}

export async function loadDesignLibraryEntries(): Promise<DesignLibraryEntry[]> {
  try {
    const rawText = await fetchPublicText(publicAssetUrl('figma/designs.json'));
    const parsed = JSON.parse(rawText) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error('Figma design metadata must be a JSON array.');
    }

    return parsed
      .filter(
        (entry): entry is DesignLibraryEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          'name' in entry &&
          'description' in entry &&
          'figmaUrl' in entry,
      )
      .map((entry) => ({
        name: String(entry.name),
        description: String(entry.description),
        figmaUrl: String(entry.figmaUrl),
        updatedAt:
          'updatedAt' in entry && typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
      }));
  } catch (error) {
    if (error instanceof Error && /not found|404/i.test(error.message)) {
      return [];
    }
    throw error;
  }
}

export function getFileExtension(fileName: string): SpecFileExtension | null {
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName.endsWith('.json')) {
    return 'json';
  }
  if (lowerFileName.endsWith('.yaml')) {
    return 'yaml';
  }
  if (lowerFileName.endsWith('.yml')) {
    return 'yml';
  }
  return null;
}

export function formatServiceSecondaryText(service: ServiceCatalogEntry): string {
  const versionCount = service.versions.length;
  const versionLabel = versionCount === 1 ? 'version' : 'versions';
  return `Latest ${service.latestVersion} · ${versionCount} ${versionLabel}`;
}
