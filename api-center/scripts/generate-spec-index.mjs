import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const statusField = 'x-api-center-status';

function normalizePrefix(value) {
  return (value || 'specs').replace(/^\/+|\/+$/g, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function loadSpecStatus(filePath, extension) {
  try {
    const body = fs.readFileSync(filePath, 'utf8');
    if (extension === 'json') {
      const parsed = JSON.parse(body);
      return normalizeStatus(
        parsed && typeof parsed === 'object' && parsed !== null && statusField in parsed
          ? parsed[statusField]
          : undefined,
      );
    }
    const parsed = yaml.load(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && statusField in parsed) {
      return normalizeStatus(parsed[statusField]);
    }
    return 'approved';
  } catch {
    return 'approved';
  }
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

/**
 * Recursively collect file paths under dir (sync).
 * @param {string} dir
 * @returns {string[]}
 */
function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {{ rootDir?: string; specsPrefix?: string }} [options]
 * @returns {{ generatedAt: string; services: ReturnType<typeof buildCatalog> }}
 */
export function buildSpecIndexFromFilesystem(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const specsPrefix = normalizePrefix(options.specsPrefix ?? process.env.VITE_SPECS_PREFIX);
  const specsAbs = path.join(rootDir, 'public', specsPrefix);
  const filePattern = new RegExp(
    `^${escapeRegExp(specsPrefix)}\\/([^/]+)\\/([^/]+)\\/openapi\\.(json|yaml|yml)$`,
    'i',
  );

  const allFiles = walkFiles(specsAbs);
  const versions = [];

  for (const absPath of allFiles) {
    const relFromPublic = path.relative(path.join(rootDir, 'public'), absPath).split(path.sep).join('/');
    if (relFromPublic === `${specsPrefix}/index.json` || relFromPublic.endsWith('/index.json')) {
      continue;
    }

    const match = relFromPublic.match(filePattern);
    if (!match) {
      continue;
    }

    const [, serviceName, version, extension] = match;
    const stat = fs.statSync(absPath);
    const contentType = extension.toLowerCase() === 'json' ? 'application/json' : 'application/yaml';
    const status = loadSpecStatus(absPath, extension.toLowerCase());

    versions.push({
      serviceName,
      version,
      key: relFromPublic,
      extension: extension.toLowerCase(),
      contentType,
      status,
      lastModified: stat.mtime.toISOString(),
      size: stat.size,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    services: buildCatalog(versions.filter(Boolean)),
  };
}

/**
 * Writes public/{specsPrefix}/index.json under rootDir.
 * @param {{ rootDir?: string; specsPrefix?: string }} [options]
 */
export function writeSpecIndexFile(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const specsPrefix = normalizePrefix(options.specsPrefix ?? process.env.VITE_SPECS_PREFIX);
  const specsAbs = path.join(rootDir, 'public', specsPrefix);
  if (!fs.existsSync(specsAbs)) {
    fs.mkdirSync(specsAbs, { recursive: true });
  }

  const index = buildSpecIndexFromFilesystem({ rootDir, specsPrefix });
  const indexPath = path.join(specsAbs, 'index.json');
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return indexPath;
}

async function main() {
  const out = writeSpecIndexFile();
  process.stdout.write(`${out}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
