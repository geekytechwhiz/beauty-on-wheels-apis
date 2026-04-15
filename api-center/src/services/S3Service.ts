import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
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

const DEFAULT_SPECS_PREFIX = 'specs';
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

function buildPublicObjectUrl(key: string): string {
  const encodedKey = encodeURIComponentPath(key);
  const cloudFrontBaseUrl = getCloudFrontBaseUrl();
  if (cloudFrontBaseUrl) {
    return `${cloudFrontBaseUrl}/${encodedKey}`;
  }

  throw new Error('CloudFront URL is not configured.');
}

async function readResponseBodyAsText(body: unknown): Promise<string> {
  if (
    body &&
    typeof body === 'object' &&
    'transformToString' in body &&
    typeof (body as { transformToString?: unknown }).transformToString === 'function'
  ) {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }

  if (body instanceof Blob) {
    return body.text();
  }

  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }

  throw new Error('Unable to read the S3 object body as text.');
}

function encodeURIComponentPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function fetchPublicText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, application/yaml, text/yaml, text/plain, application/xml, text/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to load ${url}. Received ${response.status} ${response.statusText}.`);
  }

  return response.text();
}

async function loadPublicSpecText(key: string): Promise<string> {
  return fetchPublicText(buildPublicObjectUrl(key));
}

async function loadS3SpecText(key: string): Promise<string> {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }),
  );

  return readResponseBodyAsText(response.Body);
}

export function createS3Client(): S3Client {
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

function parseSpecFileKey(key: string, object?: _Object): OpenApiSpecFile | null {
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
    status: DEFAULT_SPEC_REVIEW_STATUS,
    lastModified: object?.LastModified?.toISOString(),
    size: object?.Size,
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

function extractStatusFromParsedSpec(parsedSpec: Record<string, unknown>): SpecReviewStatus {
  const rawStatus = parsedSpec[SPEC_REVIEW_STATUS_FIELD];
  return normalizeSpecReviewStatus(typeof rawStatus === 'string' ? rawStatus : undefined);
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

function buildCatalog(objects: _Object[]): ServiceCatalogEntry[] {
  const grouped = new Map<string, OpenApiSpecFile[]>();

  for (const object of objects) {
    if (!object.Key) {
      continue;
    }

    const parsed = parseSpecFileKey(object.Key, object);
    if (!parsed) {
      continue;
    }

    const existing = grouped.get(parsed.serviceName) ?? [];
    const duplicateIndex = existing.findIndex((item) => item.version === parsed.version);
    if (duplicateIndex >= 0) {
      existing[duplicateIndex] = pickPreferredFile(existing[duplicateIndex], parsed);
    } else {
      existing.push(parsed);
    }
    grouped.set(parsed.serviceName, existing);
  }

  return Array.from(grouped.entries())
    .map(([name, versions]) => {
      const sortedVersions = [...versions].sort((left, right) =>
        compareVersionsDesc(left.version, right.version),
      );

      return {
        name,
        latestVersion: sortedVersions[0]?.version ?? '',
        versions: sortedVersions,
      };
    })
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

async function listAllSpecObjects(prefix?: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;
  const effectivePrefix = prefix ? `${getSpecsPrefix()}/${prefix}` : `${getSpecsPrefix()}/`;

  do {
    const response = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: getBucketName(),
        Prefix: effectivePrefix,
        ContinuationToken: continuationToken,
      }),
    );

    objects.push(...(response.Contents ?? []));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

export async function listServices(): Promise<ServiceCatalogEntry[]> {
  const objects = await listAllSpecObjects();
  return buildCatalog(objects);
}

export async function listVersions(serviceName: string): Promise<OpenApiSpecFile[]> {
  const normalizedServiceName = normalizeSegment(serviceName, 'Service name');
  const objects = await listAllSpecObjects(`${normalizedServiceName}/`);
  const catalog = buildCatalog(objects);
  const versions = catalog[0]?.versions ?? [];

  const versionsWithStatus = await Promise.all(
    versions.map(async (version) => {
      try {
        const rawText = await loadS3SpecText(version.key);
        const parsedSpec = parseOpenApiText(rawText, version.extension);

        return {
          ...version,
          status: extractStatusFromParsedSpec(parsedSpec),
        };
      } catch {
        return version;
      }
    }),
  );

  return versionsWithStatus;
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

  return {
    serviceName: normalizedServiceName,
    version: normalizedVersion,
    key,
    extension: validatedFile.extension,
    contentType: validatedFile.contentType,
    status: DEFAULT_SPEC_REVIEW_STATUS,
  };
}

async function resolveSpecVersion({
  serviceName,
  version,
}: DeleteSpecVersionInput): Promise<OpenApiSpecFile> {
  const versions = await listVersions(serviceName);
  const resolved = versions.find((item) => item.version === version);
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
  const rawText = await loadS3SpecText(resolved.key);
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

  return {
    serviceName: normalizedServiceName,
    version: normalizedVersion,
    key,
    extension: 'yaml',
    contentType: getContentType('yaml'),
    status: DEFAULT_SPEC_REVIEW_STATUS,
  };
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
  const bucketName = getBucketName();
  const existingObject = await getS3Client().send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: resolved.key,
    }),
  );
  const rawText = await readResponseBodyAsText(existingObject.Body);
  const parsedSpec = parseOpenApiText(rawText, resolved.extension);
  const nextBody = serializeSpecWithStatus(parsedSpec, resolved.extension, status);

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: resolved.key,
      Body: nextBody,
      ContentType: existingObject.ContentType ?? resolved.contentType,
      Metadata: {
        service: resolved.serviceName,
        version: resolved.version,
        status,
      },
    }),
  );

  return {
    ...resolved,
    status,
  };
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
