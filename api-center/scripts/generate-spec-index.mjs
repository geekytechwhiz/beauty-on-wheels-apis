import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

const bucket = requiredEnv('S3_BUCKET');
const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
const specsPrefix = normalizePrefix(process.env.VITE_S3_SPECS_PREFIX?.trim() || 'specs');
const indexKey = normalizeKey(process.env.VITE_S3_SPECS_INDEX_KEY?.trim() || `${specsPrefix}/index.json`);
const statusField = 'x-api-center-status';
const filePattern = new RegExp(`^${escapeRegExp(specsPrefix)}\\/([^/]+)\\/([^/]+)\\/openapi\\.(json|yaml|yml)$`, 'i');
const client = new S3Client({ region });

async function main() {
  const objects = await listAllSpecObjects();
  const versions = await Promise.all(
    objects.map(async (object) => {
      if (!object.Key) {
        return null;
      }

      const match = object.Key.match(filePattern);
      if (!match) {
        return null;
      }

      const [, serviceName, version, extension] = match;
      const contentType = extension.toLowerCase() === 'json' ? 'application/json' : 'application/yaml';
      const status = await loadSpecStatus(object.Key, extension.toLowerCase());

      return {
        serviceName,
        version,
        key: object.Key,
        extension: extension.toLowerCase(),
        contentType,
        status,
        lastModified: object.LastModified?.toISOString(),
        size: object.Size,
      };
    }),
  );

  const index = {
    generatedAt: new Date().toISOString(),
    services: buildCatalog(versions.filter(Boolean)),
  };

  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}

async function listAllSpecObjects() {
  const objects = [];
  let continuationToken;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${specsPrefix}/`,
        ContinuationToken: continuationToken,
      }),
    );

    objects.push(...(response.Contents || []));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

async function loadSpecStatus(key, extension) {
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    const body = await readResponseBodyAsText(response.Body);
    const parsed = extension === 'json' ? JSON.parse(body) : parseYamlStatus(body);
    return normalizeStatus(parsed?.[statusField]);
  } catch {
    return 'approved';
  }
}

async function readResponseBodyAsText(body) {
  if (
    body &&
    typeof body === 'object' &&
    'transformToString' in body &&
    typeof body.transformToString === 'function'
  ) {
    return body.transformToString();
  }

  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }

  throw new Error('Unable to read S3 response body.');
}

function parseYamlStatus(body) {
  const statusPattern = new RegExp(`^${escapeRegExp(statusField)}\\s*:\\s*("?)([^"\\n]+)\\1\\s*$`, 'm');
  const match = body.match(statusPattern);
  return match ? { [statusField]: match[2].trim() } : {};
}

function normalizeStatus(value) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'pending':
      return 'pending';
    default:
      return 'approved';
  }
}

function buildCatalog(versions) {
  const grouped = new Map();

  for (const version of versions) {
    const currentVersions = grouped.get(version.serviceName) || [];
    const duplicateIndex = currentVersions.findIndex((item) => item.version === version.version);

    if (duplicateIndex >= 0) {
      currentVersions[duplicateIndex] = pickPreferredFile(currentVersions[duplicateIndex], version);
    } else {
      currentVersions.push(version);
    }

    grouped.set(version.serviceName, currentVersions);
  }

  return Array.from(grouped.entries())
    .map(([name, serviceVersions]) => {
      const sortedVersions = [...serviceVersions].sort((left, right) =>
        compareVersionsDesc(left.version, right.version),
      );

      return {
        name,
        latestVersion: sortedVersions[0]?.version || '',
        versions: sortedVersions,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
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

function compareVersionsDesc(left, right) {
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

  return right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' });
}

function parseSemanticVersion(version) {
  const match = version.trim().match(/^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i);
  if (!match) {
    return null;
  }

  const [, prefix, major, minor, patch] = match;
  return {
    prefix,
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor || '0', 10),
    patch: Number.parseInt(patch || '0', 10),
  };
}

function normalizePrefix(value) {
  return value.replace(/^\/+|\/+$/g, '');
}

function normalizeKey(value) {
  return value.replace(/^\/+/, '');
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
