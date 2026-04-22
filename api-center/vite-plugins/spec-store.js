import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
const SPEC_STATUS = 'x-api-center-status';
const OPENAPI_FILE_PATTERN = /^(.+?)\/(.+?)\/openapi\.(json|yaml|yml)$/i;
const VERSION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const SEMVER_PATTERN = /^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i;
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
function parseSemanticVersion(version) {
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
    return VERSION_COLLATOR.compare(right, left);
}
function parseOpenApiText(rawText, extension) {
    const parsedSpec = extension === 'json' ? JSON.parse(rawText) : yaml.load(rawText);
    if (!parsedSpec || typeof parsedSpec !== 'object' || Array.isArray(parsedSpec)) {
        throw new Error('The OpenAPI document must be a YAML or JSON object.');
    }
    const openapiValue = parsedSpec.openapi;
    if (typeof openapiValue !== 'string' || openapiValue.trim() === '') {
        throw new Error('The OpenAPI document must include a valid `openapi` version field.');
    }
    const infoValue = parsedSpec.info;
    if (!infoValue || typeof infoValue !== 'object' || Array.isArray(infoValue)) {
        throw new Error('The OpenAPI document must include an `info` object.');
    }
    return parsedSpec;
}
function serializeSpecWithStatus(parsedSpec, extension, status) {
    const nextSpec = {
        ...parsedSpec,
        [SPEC_STATUS]: status,
    };
    if (extension === 'json') {
        return JSON.stringify(nextSpec, null, 2);
    }
    return yaml.dump(nextSpec, { noRefs: true, lineWidth: 120 });
}
function normalizeStatus(value) {
    if (typeof value !== 'string') {
        return 'pending';
    }
    switch (value.trim().toLowerCase()) {
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
    if (lower.endsWith('.json'))
        return 'json';
    if (lower.endsWith('.yaml'))
        return 'yaml';
    if (lower.endsWith('.yml'))
        return 'yml';
    return null;
}
function getContentType(extension) {
    return extension === 'json' ? 'application/json' : 'application/yaml';
}
function walkFiles(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkFiles(abs));
        }
        else if (entry.isFile()) {
            out.push(abs);
        }
    }
    return out;
}
export class LocalSpecStore {
    rootDir;
    specsDir;
    prefix;
    catalog = [];
    constructor(options) {
        this.rootDir = options.rootDir;
        this.specsDir =
            options.specsDir && options.specsDir.trim()
                ? path.resolve(this.rootDir, options.specsDir.trim())
                : path.resolve(this.rootDir, 'specs-store');
        this.prefix = (options.prefix ?? 'specs').replace(/^\/+|\/+$/g, '');
        fs.mkdirSync(this.specsDir, { recursive: true });
        this.rebuildIndex();
    }
    getSpecsDir() {
        return this.specsDir;
    }
    getCatalog() {
        return {
            generatedAt: new Date().toISOString(),
            services: this.catalog,
        };
    }
    listServices() {
        return this.catalog;
    }
    listVersions(serviceName) {
        const normalizedService = normalizeSegment(serviceName, 'Service name');
        return this.catalog.find((service) => service.name === normalizedService)?.versions ?? [];
    }
    readSpecText(serviceName, version) {
        const resolved = this.resolveSpecFile(serviceName, version);
        if (!resolved) {
            throw new Error('OpenAPI file not found for this service/version.');
        }
        const text = fs.readFileSync(resolved.filePath, 'utf8');
        return { extension: resolved.extension, text };
    }
    upload(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        const extension = extensionFromFileName(params.fileName);
        if (!extension) {
            throw new Error('Only .yaml, .yml, and .json files are supported.');
        }
        const parsed = parseOpenApiText(Buffer.from(params.contentBase64, 'base64').toString('utf8'), extension);
        const outDir = path.join(this.specsDir, serviceName, version);
        const outPath = path.join(outDir, `openapi.${extension}`);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outPath, serializeSpecWithStatus(parsed, extension, 'approved'), 'utf8');
        this.rebuildIndex();
        const created = this.findVersion(serviceName, version);
        if (!created) {
            throw new Error('Unable to index uploaded OpenAPI document.');
        }
        return created;
    }
    saveEdited(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        if (this.findVersion(serviceName, version)) {
            throw new Error(`Version ${version} already exists for ${serviceName}.`);
        }
        const parsed = parseOpenApiText(params.yamlText, 'yaml');
        const outDir = path.join(this.specsDir, serviceName, version);
        const outPath = path.join(outDir, 'openapi.yaml');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outPath, serializeSpecWithStatus(parsed, 'yaml', 'approved'), 'utf8');
        this.rebuildIndex();
        const created = this.findVersion(serviceName, version);
        if (!created) {
            throw new Error('Unable to index saved OpenAPI document.');
        }
        return created;
    }
    updateStatus(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        const resolved = this.resolveSpecFile(serviceName, version);
        if (!resolved) {
            throw new Error('OpenAPI file not found for this service/version.');
        }
        const rawText = fs.readFileSync(resolved.filePath, 'utf8');
        const parsed = parseOpenApiText(rawText, resolved.extension);
        fs.writeFileSync(resolved.filePath, serializeSpecWithStatus(parsed, resolved.extension, params.status), 'utf8');
        this.rebuildIndex();
        const updated = this.findVersion(serviceName, version);
        if (!updated) {
            throw new Error('Unable to index updated OpenAPI document.');
        }
        return updated;
    }
    deleteVersion(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        const dir = path.join(this.specsDir, serviceName, version);
        if (fs.existsSync(dir)) {
            for (const ext of ['json', 'yaml', 'yml']) {
                const p = path.join(dir, `openapi.${ext}`);
                if (fs.existsSync(p)) {
                    fs.unlinkSync(p);
                }
            }
            const maybeEmpty = fs.readdirSync(dir);
            if (maybeEmpty.length === 0) {
                fs.rmdirSync(dir);
            }
        }
        this.rebuildIndex();
    }
    rebuildIndex() {
        const grouped = new Map();
        const allFiles = walkFiles(this.specsDir);
        for (const filePath of allFiles) {
            const rel = path.relative(this.specsDir, filePath).split(path.sep).join('/');
            const match = rel.match(OPENAPI_FILE_PATTERN);
            if (!match) {
                continue;
            }
            const [, serviceName, version, rawExtension] = match;
            const extension = rawExtension.toLowerCase();
            const stat = fs.statSync(filePath);
            const rawText = fs.readFileSync(filePath, 'utf8');
            const parsed = parseOpenApiText(rawText, extension);
            const status = normalizeStatus(parsed[SPEC_STATUS]);
            const entry = {
                serviceName,
                version,
                key: `${this.prefix}/${serviceName}/${version}/openapi.${extension}`,
                extension,
                contentType: getContentType(extension),
                status,
                lastModified: stat.mtime.toISOString(),
                size: stat.size,
            };
            const existing = grouped.get(serviceName) ?? [];
            existing.push(entry);
            grouped.set(serviceName, existing);
        }
        this.catalog = Array.from(grouped.entries())
            .map(([serviceName, versions]) => {
            const dedup = new Map();
            for (const item of versions) {
                const current = dedup.get(item.version);
                if (!current) {
                    dedup.set(item.version, item);
                    continue;
                }
                if (item.extension === 'json' && current.extension !== 'json') {
                    dedup.set(item.version, item);
                }
            }
            const sorted = Array.from(dedup.values()).sort((a, b) => compareVersionsDesc(a.version, b.version));
            return {
                name: serviceName,
                latestVersion: sorted[0]?.version ?? '',
                versions: sorted,
            };
        })
            .filter((service) => service.versions.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    resolveSpecFile(serviceName, version) {
        const normalizedService = normalizeSegment(serviceName, 'Service name');
        const normalizedVersion = normalizeSegment(version, 'Version');
        const dir = path.join(this.specsDir, normalizedService, normalizedVersion);
        for (const ext of ['json', 'yaml', 'yml']) {
            const filePath = path.join(dir, `openapi.${ext}`);
            if (fs.existsSync(filePath)) {
                return { filePath, extension: ext };
            }
        }
        return null;
    }
    findVersion(serviceName, version) {
        return this.listVersions(serviceName).find((item) => item.version === version) ?? null;
    }
}
