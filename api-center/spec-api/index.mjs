import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import yaml from 'js-yaml';

const SPEC_STATUS = 'x-api-center-status';
const OPENAPI_FILE_PATTERN = /^([^/]+)\/([^/]+)\/openapi\.(json|yaml|yml)$/i;

const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({});

function env(name, fallback = '') {
  return (process.env[name] ?? fallback).trim();
}

function bucket() {
  return env('S3_BUCKET');
}

function s3AppPrefix() {
  return env('S3_APP_PREFIX').replace(/^\/+|\/+$/g, '');
}

function specsPrefix() {
  return env('SPECS_PREFIX', 'specs-store').replace(/^\/+|\/+$/g, '');
}

function s3SpecsRoot() {
  const app = s3AppPrefix();
  return app ? `${app}/${specsPrefix()}` : specsPrefix();
}

function toS3Key(relativeSpecPath) {
  return `${s3SpecsRoot()}/${relativeSpecPath.replace(/^\/+/, '')}`;
}

function toCatalogKey(relativeSpecPath) {
  return `${specsPrefix()}/${relativeSpecPath.replace(/^\/+/, '')}`;
}

function normalizeSegment(value, label) {
  const normalized = value.trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.includes('/')) {
    throw new Error(`${label} cannot contain "/".`);
  }
  return normalized;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode, message) {
  return jsonResponse(statusCode, { error: message });
}

async function readBody(event) {
  if (!event.body) {
    return '';
  }
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function parseOpenApiText(rawText, extension) {
  const parsed =
    extension === 'json' ? JSON.parse(rawText) : yaml.load(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The OpenAPI document must be a YAML or JSON object.');
  }
  const openapiValue = parsed.openapi;
  if (typeof openapiValue !== 'string' || openapiValue.trim() === '') {
    throw new Error('The OpenAPI document must include a valid `openapi` version field.');
  }
  const infoValue = parsed.info;
  if (!infoValue || typeof infoValue !== 'object' || Array.isArray(infoValue)) {
    throw new Error('The OpenAPI document must include an `info` object.');
  }
  return parsed;
}

function serializeSpecWithStatus(parsedSpec, extension, status) {
  const nextSpec = { ...parsedSpec, [SPEC_STATUS]: status };
  if (extension === 'json') {
    return JSON.stringify(nextSpec, null, 2);
  }
  return yaml.dump(nextSpec, { noRefs: true, lineWidth: 120 });
}

function normalizeStatus(value) {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

function extensionFromFileName(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.yml')) return 'yml';
  return null;
}

function getContentType(extension) {
  return extension === 'json' ? 'application/json' : 'application/yaml';
}

function compareVersionsDesc(left, right) {
  return right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' });
}

function pickPreferredFile(current, candidate) {
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

async function getObjectText(key) {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
    }),
  );
  return response.Body.transformToString('utf8');
}

async function putObjectText(key, text, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: text,
      ContentType: contentType,
      CacheControl: 'no-cache,no-store,must-revalidate',
    }),
  );
}

async function deleteObject(key) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket(),
      Key: key,
    }),
  );
}

async function listSpecObjects() {
  const prefix = `${s3SpecsRoot()}/`;
  const objects = [];
  let continuationToken;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of response.Contents ?? []) {
      if (!item.Key || item.Key.endsWith('/index.json')) {
        continue;
      }
      const relativeKey = item.Key.slice(prefix.length);
      const match = relativeKey.match(OPENAPI_FILE_PATTERN);
      if (!match) {
        continue;
      }
      objects.push({
        key: item.Key,
        relativeKey,
        serviceName: match[1],
        version: match[2],
        extension: match[3].toLowerCase(),
        lastModified: item.LastModified?.toISOString(),
        size: item.Size,
      });
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

async function buildCatalog() {
  const grouped = new Map();

  for (const item of await listSpecObjects()) {
    const rawText = await getObjectText(item.key);
    const parsed = parseOpenApiText(rawText, item.extension);
    const entry = {
      serviceName: item.serviceName,
      version: item.version,
      key: toCatalogKey(item.relativeKey),
      extension: item.extension,
      contentType: getContentType(item.extension),
      status: normalizeStatus(parsed[SPEC_STATUS]),
      lastModified: item.lastModified,
      size: item.size,
    };

    const existing = grouped.get(item.serviceName) ?? [];
    const duplicateIndex = existing.findIndex((version) => version.version === entry.version);
    if (duplicateIndex >= 0) {
      existing[duplicateIndex] = pickPreferredFile(existing[duplicateIndex], entry);
    } else {
      existing.push(entry);
    }
    grouped.set(item.serviceName, existing);
  }

  const services = Array.from(grouped.entries())
    .map(([name, versions]) => {
      const sorted = [...versions].sort((left, right) =>
        compareVersionsDesc(left.version, right.version),
      );
      return {
        name,
        latestVersion: sorted[0]?.version ?? '',
        versions: sorted,
      };
    })
    .filter((service) => service.versions.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    generatedAt: new Date().toISOString(),
    services,
  };
}

async function writeCatalogIndex() {
  const catalog = await buildCatalog();
  await putObjectText(
    toS3Key('index.json'),
    `${JSON.stringify(catalog, null, 2)}\n`,
    'application/json',
  );
  return catalog;
}

async function findVersion(serviceName, version) {
  const catalog = await buildCatalog();
  return (
    catalog.services
      .find((service) => service.name === serviceName)
      ?.versions.find((item) => item.version === version) ?? null
  );
}

async function resolveSpecFile(serviceName, version) {
  const normalizedService = normalizeSegment(serviceName, 'Service name');
  const normalizedVersion = normalizeSegment(version, 'Version');

  for (const extension of ['json', 'yaml', 'yml']) {
    const key = toS3Key(`${normalizedService}/${normalizedVersion}/openapi.${extension}`);
    try {
      const text = await getObjectText(key);
      return { key, extension, text };
    } catch {
      // try next extension
    }
  }

  return null;
}

async function invalidatePaths(paths) {
  const distributionId = env('CLOUDFRONT_DISTRIBUTION_ID');
  if (!distributionId || paths.length === 0) {
    return;
  }

  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `${Date.now()}`,
        Paths: {
          Quantity: paths.length,
          Items: paths,
        },
      },
    }),
  );
}

async function invalidateSpecPaths(catalogKeys) {
  const appPrefix = s3AppPrefix();
  const paths = new Set([`/${appPrefix}/${specsPrefix()}/index.json`]);
  for (const key of catalogKeys) {
    paths.add(`/${appPrefix}/${key.replace(/^\/+/, '')}`);
  }
  await invalidatePaths(Array.from(paths));
}

export async function handler(event) {
  try {
    const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';
    const rawPath = event.rawPath ?? event.path ?? '/';
    const pathname = rawPath.replace(/\/+$/, '') || '/';

    if (method === 'GET' && pathname === '/catalog') {
      return jsonResponse(200, await buildCatalog());
    }

    if (method === 'GET' && pathname === '/document') {
      const params = event.queryStringParameters ?? {};
      const resolved = await resolveSpecFile(params.serviceName ?? '', params.version ?? '');
      if (!resolved) {
        return errorResponse(404, 'OpenAPI file not found for this service/version.');
      }
      return jsonResponse(200, {
        extension: resolved.extension,
        text: resolved.text,
      });
    }

    if (method === 'POST' && pathname === '/upload') {
      const body = JSON.parse(await readBody(event));
      if (!body.fileName || !body.contentBase64) {
        return errorResponse(400, 'fileName and contentBase64 are required.');
      }

      const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
      const version = normalizeSegment(body.version ?? '', 'Version');
      const extension = extensionFromFileName(body.fileName);
      if (!extension) {
        return errorResponse(400, 'Only .yaml, .yml, and .json files are supported.');
      }

      const parsed = parseOpenApiText(
        Buffer.from(body.contentBase64, 'base64').toString('utf8'),
        extension,
      );
      const relativePath = `${serviceName}/${version}/openapi.${extension}`;
      await putObjectText(
        toS3Key(relativePath),
        serializeSpecWithStatus(parsed, extension, 'approved'),
        getContentType(extension),
      );
      await writeCatalogIndex();
      const created = await findVersion(serviceName, version);
      if (!created) {
        return errorResponse(500, 'Unable to index uploaded OpenAPI document.');
      }
      await invalidateSpecPaths([created.key]);
      return jsonResponse(200, created);
    }

    if (method === 'POST' && pathname === '/save-edited') {
      const body = JSON.parse(await readBody(event));
      if (typeof body.yamlText !== 'string') {
        return errorResponse(400, 'yamlText is required.');
      }

      const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
      const version = normalizeSegment(body.version ?? '', 'Version');
      if (await findVersion(serviceName, version)) {
        return errorResponse(400, `Version ${version} already exists for ${serviceName}.`);
      }

      const parsed = parseOpenApiText(body.yamlText, 'yaml');
      const relativePath = `${serviceName}/${version}/openapi.yaml`;
      await putObjectText(
        toS3Key(relativePath),
        serializeSpecWithStatus(parsed, 'yaml', 'approved'),
        getContentType('yaml'),
      );
      await writeCatalogIndex();
      const created = await findVersion(serviceName, version);
      if (!created) {
        return errorResponse(500, 'Unable to index saved OpenAPI document.');
      }
      await invalidateSpecPaths([created.key]);
      return jsonResponse(200, created);
    }

    if (method === 'PATCH' && pathname === '/status') {
      const body = JSON.parse(await readBody(event));
      const status = body.status;
      if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
        return errorResponse(400, 'status must be pending, approved, or rejected.');
      }

      const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
      const version = normalizeSegment(body.version ?? '', 'Version');
      const resolved = await resolveSpecFile(serviceName, version);
      if (!resolved) {
        return errorResponse(404, 'OpenAPI file not found for this service/version.');
      }

      const parsed = parseOpenApiText(resolved.text, resolved.extension);
      await putObjectText(
        resolved.key,
        serializeSpecWithStatus(parsed, resolved.extension, status),
        getContentType(resolved.extension),
      );
      await writeCatalogIndex();
      const updated = await findVersion(serviceName, version);
      if (!updated) {
        return errorResponse(500, 'Unable to index updated OpenAPI document.');
      }
      await invalidateSpecPaths([updated.key]);
      return jsonResponse(200, updated);
    }

    if (method === 'POST' && pathname === '/delete') {
      const body = JSON.parse(await readBody(event));
      const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
      const version = normalizeSegment(body.version ?? '', 'Version');
      const catalogKeys = [];

      for (const extension of ['json', 'yaml', 'yml']) {
        const key = toS3Key(`${serviceName}/${version}/openapi.${extension}`);
        try {
          await deleteObject(key);
          catalogKeys.push(toCatalogKey(`${serviceName}/${version}/openapi.${extension}`));
        } catch {
          // ignore missing objects
        }
      }

      await writeCatalogIndex();
      await invalidateSpecPaths(catalogKeys);
      return jsonResponse(200, { ok: true });
    }

    return errorResponse(404, 'Not found.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed.';
    return errorResponse(400, message);
  }
}
