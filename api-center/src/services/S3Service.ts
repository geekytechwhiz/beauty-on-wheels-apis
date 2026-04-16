import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

const DEFAULT_SPECS_PREFIX = 'specs';
const DEFAULT_PUBLIC_CATALOG_KEY = `${DEFAULT_SPECS_PREFIX}/index.json`;
const DEFAULT_SPEC_REVIEW_STATUS: SpecReviewStatus = 'approved';
const DEFAULT_CLOUDFRONT_PUBLIC_URL = 'https://d28d5t5u0n3bd1.cloudfront.net';
const OPENAPI_FILE_PATTERN = /^(.+?)\/(.+?)\/openapi\.(json|yaml|yml)$/i;
const VERSION_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});
const SEMVER_PATTERN = /^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i;

let cachedClient: S3Client | null = null;

function getEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBucketName(): string {
  return getEnv('VITE_S3_BUCKET_NAME');
}

function getSpecsPrefix(): string {
  const rawPrefix = import.meta.env.VITE_S3_SPECS_PREFIX?.trim();
  if (!rawPrefix) {
    return DEFAULT_SPECS_PREFIX;
  }

  return rawPrefix.replace(/^\/+|\/+$/g, '');
}

function getFigmaDesignsKey(): string {
  const rawKey = import.meta.env.VITE_S3_FIGMA_DESIGNS_KEY?.trim();
  if (!rawKey) {
    return 'figma/designs.json';
  }

  return rawKey.replace(/^\/+/, '');
}

function getPublicCatalogKey(): string {
  const rawKey = import.meta.env.VITE_S3_SPECS_INDEX_KEY?.trim();
  if (!rawKey) {
    return DEFAULT_PUBLIC_CATALOG_KEY;
  }

  return rawKey.replace(/^\/+/, '');
}

function getCloudFrontBaseUrl(): string | null {
  const rawUrl = import.meta.env.VITE_CLOUDFRONT_URL?.trim();
  const normalized = (rawUrl || DEFAULT_CLOUDFRONT_PUBLIC_URL).replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
  return normalized || null;
}

export function getS3ConfigSummary(): {
  bucketName: string;
  region: string;
  specsPrefix: string;
} {
  return {
    bucketName: getBucketName(),
    region: getEnv('VITE_AWS_REGION'),
    specsPrefix: getSpecsPrefix(),
  };
}

export function canWriteToS3FromBrowser(): boolean {
  const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY?.trim();
  return Boolean(accessKeyId && secretAccessKey);
}

function buildPublicObjectUrl(key: string): string {
  const encodedKey = encodeURIComponentPath(key);
  const cloudFrontBaseUrl = getCloudFrontBaseUrl();
  if (cloudFrontBaseUrl) {
    return `${cloudFrontBaseUrl}/${encodedKey}`;
  }

  throw new Error('CloudFront URL is not configured.');
}

function encodeURIComponentPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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

async function loadPublicSpecText(key: string, options?: { cacheBust?: boolean }): Promise<string> {
  return fetchPublicText(buildPublicObjectUrl(key), options);
}

export function createS3Client(): S3Client {
  if (!canWriteToS3FromBrowser()) {
    throw new Error(
      'Browser S3 write access is not configured. This deployment is read-only and serves specs through CloudFront.',
    );
  }

  return new S3Client({
    region: getEnv('VITE_AWS_REGION'),
    credentials: {
      accessKeyId: getEnv('VITE_AWS_ACCESS_KEY_ID'),
      secretAccessKey: getEnv('VITE_AWS_SECRET_ACCESS_KEY'),
    },
  });
}

function getS3Client(): S3Client {
  if (cachedClient === null) {
    cachedClient = createS3Client();
  }
  return cachedClient;
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

function serializeSpecWithStatus(
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

export function normalizeSpecToYaml(
  parsedSpec: Record<string, unknown>,
): string {
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

function createEmptyCatalogIndex(): PublicCatalogIndex {
  return {
    generatedAt: new Date().toISOString(),
    services: [],
  };
}

function isMissingPublicFileError(error: unknown): boolean {
  return error instanceof Error && /NoSuchKey|not found|404/i.test(error.message);
}

function parseCatalogIndex(rawValue: unknown): PublicCatalogIndex {
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
    const rawText = await loadPublicSpecText(getPublicCatalogKey(), { cacheBust: true });
    const parsed = JSON.parse(rawText) as unknown;
    return parseCatalogIndex(parsed);
  } catch (error) {
    if (options?.allowMissing && isMissingPublicFileError(error)) {
      return createEmptyCatalogIndex();
    }

    if (isMissingPublicFileError(error)) {
      throw new Error(
        `Unable to load the public API catalog index from CloudFront at ${getPublicCatalogKey()}. Generate the index and make sure CloudFront can serve it.`,
      );
    }

    throw error;
  }
}

async function saveCatalogIndex(index: PublicCatalogIndex): Promise<void> {
  const normalizedIndex: PublicCatalogIndex = {
    generatedAt: new Date().toISOString(),
    services: normalizeCatalog(index.services),
  };

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: getPublicCatalogKey(),
      Body: JSON.stringify(normalizedIndex, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-cache, no-store, must-revalidate',
    }),
  );
}

function upsertCatalogEntry(index: PublicCatalogIndex, entry: OpenApiSpecFile): PublicCatalogIndex {
  const existingService = index.services.find((service) => service.name === entry.serviceName) ?? null;
  const otherServices = index.services.filter((service) => service.name !== entry.serviceName);
  const nextVersions = [
    ...(existingService?.versions.filter((version) => version.version !== entry.version) ?? []),
    entry,
  ];

  return {
    generatedAt: new Date().toISOString(),
    services: normalizeCatalog([
      ...otherServices,
      {
        name: entry.serviceName,
        latestVersion: entry.version,
        versions: nextVersions,
      },
    ]),
  };
}

function removeCatalogEntry(
  index: PublicCatalogIndex,
  entry: Pick<OpenApiSpecFile, 'serviceName' | 'version'>,
): PublicCatalogIndex {
  const remainingServices = index.services
    .map((service) => {
      if (service.name !== entry.serviceName) {
        return service;
      }

      return {
        ...service,
        versions: service.versions.filter((version) => version.version !== entry.version),
      };
    })
    .filter((service) => service.versions.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    services: normalizeCatalog(remainingServices),
  };
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
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(version, 'Version');
  const validatedFile = await validateOpenApiFile(file);
  const normalizedTextWithStatus = serializeSpecWithStatus(
    validatedFile.parsedSpec,
    validatedFile.extension,
    DEFAULT_SPEC_REVIEW_STATUS,
  );
  const key = `${getSpecsPrefix()}/${normalizedServiceName}/${normalizedVersion}/openapi.${validatedFile.extension}`;
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: normalizedTextWithStatus,
      ContentType: validatedFile.contentType,
      Metadata: {
        service: normalizedServiceName,
        version: normalizedVersion,
        status: DEFAULT_SPEC_REVIEW_STATUS,
      },
    }),
  );

  const uploadedFile: OpenApiSpecFile = {
    serviceName: normalizedServiceName,
    version: normalizedVersion,
    key,
    extension: validatedFile.extension,
    contentType: validatedFile.contentType,
    status: DEFAULT_SPEC_REVIEW_STATUS,
  };

  const catalog = await loadCatalogIndex({ allowMissing: true });
  await saveCatalogIndex(upsertCatalogEntry(catalog, uploadedFile));

  return uploadedFile;
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
  return buildPublicObjectUrl(resolved.key);
}

export async function loadEditableSpecDocument({
  serviceName,
  version,
}: {
  serviceName: string;
  version: string;
}): Promise<EditableSpecDocument> {
  const resolved = await resolveSpecVersion({ serviceName, version });
  const rawText = await loadPublicSpecText(resolved.key, { cacheBust: true });
  const parsedSpec = parseOpenApiText(rawText, resolved.extension);

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
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(version, 'Version');
  const existingVersions = await listVersions(normalizedServiceName);

  if (existingVersions.some((existingVersion) => existingVersion.version === normalizedVersion)) {
    throw new Error(`Version ${normalizedVersion} already exists for ${normalizedServiceName}.`);
  }

  const parsedSpec = parseOpenApiText(yamlText, 'yaml');
  const key = `${getSpecsPrefix()}/${normalizedServiceName}/${normalizedVersion}/openapi.yaml`;
  const normalizedYamlWithStatus = serializeSpecWithStatus(
    parsedSpec,
    'yaml',
    DEFAULT_SPEC_REVIEW_STATUS,
  );

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: normalizedYamlWithStatus,
      ContentType: getContentType('yaml'),
      Metadata: {
        service: normalizedServiceName,
        version: normalizedVersion,
        status: DEFAULT_SPEC_REVIEW_STATUS,
      },
    }),
  );

  const savedFile: OpenApiSpecFile = {
    serviceName: normalizedServiceName,
    version: normalizedVersion,
    key,
    extension: 'yaml',
    contentType: getContentType('yaml'),
    status: DEFAULT_SPEC_REVIEW_STATUS,
  };

  const catalog = await loadCatalogIndex({ allowMissing: true });
  await saveCatalogIndex(upsertCatalogEntry(catalog, savedFile));

  return savedFile;
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
  const resolved = await resolveSpecVersion({ serviceName, version });
  const rawText = await loadPublicSpecText(resolved.key, { cacheBust: true });
  const parsedSpec = parseOpenApiText(rawText, resolved.extension);
  const nextBody = serializeSpecWithStatus(parsedSpec, resolved.extension, status);

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: resolved.key,
      Body: nextBody,
      ContentType: resolved.contentType,
      Metadata: {
        service: resolved.serviceName,
        version: resolved.version,
        status,
      },
    }),
  );

  const updatedFile: OpenApiSpecFile = {
    ...resolved,
    status,
  };

  const catalog = await loadCatalogIndex({ allowMissing: true });
  await saveCatalogIndex(upsertCatalogEntry(catalog, updatedFile));

  return updatedFile;
}

export async function deleteSpecVersion(input: DeleteSpecVersionInput): Promise<void> {
  const resolved =
    input.key !== undefined
      ? {
          ...(await resolveSpecVersion(input)),
          key: input.key,
        }
      : await resolveSpecVersion(input);

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: resolved.key,
    }),
  );

  const catalog = await loadCatalogIndex({ allowMissing: true });
  await saveCatalogIndex(removeCatalogEntry(catalog, resolved));
}

export async function loadDesignLibraryEntries(): Promise<DesignLibraryEntry[]> {
  try {
    const rawText = await loadPublicSpecText(getFigmaDesignsKey());
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
        updatedAt: 'updatedAt' in entry && typeof entry.updatedAt === 'string'
          ? entry.updatedAt
          : undefined,
      }));
  } catch (error) {
    if (error instanceof Error && /NoSuchKey|not found|404/i.test(error.message)) {
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
