import yaml from 'js-yaml';
import { getS3Service, toCatalogKey, toS3Key, } from './s3.service';
const SPEC_STATUS = 'x-api-center-status';
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
function parseOpenApiText(rawText, extension) {
    const parsed = extension === 'json' ? JSON.parse(rawText) : yaml.load(rawText);
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
export class S3SpecStore {
    s3 = getS3Service();
    async getCatalog() {
        return this.buildCatalog();
    }
    async readSpecText(serviceName, version) {
        const resolved = await this.resolveSpecFile(serviceName, version);
        if (!resolved) {
            throw new Error('OpenAPI file not found for this service/version.');
        }
        return { extension: resolved.extension, text: resolved.text };
    }
    async upload(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        const extension = extensionFromFileName(params.fileName);
        if (!extension) {
            throw new Error('Only .yaml, .yml, and .json files are supported.');
        }
        const parsed = parseOpenApiText(Buffer.from(params.contentBase64, 'base64').toString('utf8'), extension);
        const relativePath = `${serviceName}/${version}/openapi.${extension}`;
        await this.s3.uploadFile(toS3Key(relativePath), serializeSpecWithStatus(parsed, extension, 'approved'), getContentType(extension));
        await this.writeCatalogIndex();
        const created = await this.findVersion(serviceName, version);
        if (!created) {
            throw new Error('Unable to index uploaded OpenAPI document.');
        }
        return created;
    }
    async createPresignedUpload(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        const extension = extensionFromFileName(params.fileName);
        if (!extension) {
            throw new Error('Only .yaml, .yml, and .json files are supported.');
        }
        const relativePath = `${serviceName}/${version}/openapi.${extension}`;
        const key = toS3Key(relativePath);
        const contentType = getContentType(extension);
        const uploadUrl = await this.s3.getSignedUploadUrl(key, contentType);
        return { uploadUrl, key, contentType };
    }
    async completeUpload(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        const extension = extensionFromFileName(params.fileName);
        if (!extension) {
            throw new Error('Only .yaml, .yml, and .json files are supported.');
        }
        const expectedKey = toS3Key(`${serviceName}/${version}/openapi.${extension}`);
        if (params.key !== expectedKey) {
            throw new Error('Upload key does not match the expected spec location.');
        }
        const rawText = await this.s3.getObjectText(params.key);
        const parsed = parseOpenApiText(rawText, extension);
        await this.s3.uploadFile(params.key, serializeSpecWithStatus(parsed, extension, 'approved'), getContentType(extension));
        await this.writeCatalogIndex();
        const created = await this.findVersion(serviceName, version);
        if (!created) {
            throw new Error('Unable to index uploaded OpenAPI document.');
        }
        return created;
    }
    async createPresignedDownload(serviceName, version) {
        const resolved = await this.resolveSpecFile(serviceName, version);
        if (!resolved) {
            throw new Error('OpenAPI file not found for this service/version.');
        }
        const downloadUrl = await this.s3.getSignedDownloadUrl(resolved.key);
        return { downloadUrl, extension: resolved.extension };
    }
    async saveEdited(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        if (await this.findVersion(serviceName, version)) {
            throw new Error(`Version ${version} already exists for ${serviceName}.`);
        }
        const parsed = parseOpenApiText(params.yamlText, 'yaml');
        const relativePath = `${serviceName}/${version}/openapi.yaml`;
        await this.s3.uploadFile(toS3Key(relativePath), serializeSpecWithStatus(parsed, 'yaml', 'approved'), getContentType('yaml'));
        await this.writeCatalogIndex();
        const created = await this.findVersion(serviceName, version);
        if (!created) {
            throw new Error('Unable to index saved OpenAPI document.');
        }
        return created;
    }
    async updateStatus(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        const resolved = await this.resolveSpecFile(serviceName, version);
        if (!resolved) {
            throw new Error('OpenAPI file not found for this service/version.');
        }
        const parsed = parseOpenApiText(resolved.text, resolved.extension);
        await this.s3.uploadFile(resolved.key, serializeSpecWithStatus(parsed, resolved.extension, params.status), getContentType(resolved.extension));
        await this.writeCatalogIndex();
        const updated = await this.findVersion(serviceName, version);
        if (!updated) {
            throw new Error('Unable to index updated OpenAPI document.');
        }
        return updated;
    }
    async deleteVersion(params) {
        const serviceName = normalizeSegment(params.serviceName, 'Service name');
        const version = normalizeSegment(params.version, 'Version');
        for (const extension of ['json', 'yaml', 'yml']) {
            const key = toS3Key(`${serviceName}/${version}/openapi.${extension}`);
            try {
                await this.s3.deleteFile(key);
            }
            catch {
                // ignore missing objects
            }
        }
        await this.writeCatalogIndex();
    }
    async buildCatalog() {
        const grouped = new Map();
        for (const item of await this.s3.listSpecObjects()) {
            const rawText = await this.s3.getObjectText(item.key);
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
            }
            else {
                existing.push(entry);
            }
            grouped.set(item.serviceName, existing);
        }
        const services = Array.from(grouped.entries())
            .map(([name, versions]) => {
            const sorted = [...versions].sort((left, right) => compareVersionsDesc(left.version, right.version));
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
    async writeCatalogIndex() {
        const catalog = await this.buildCatalog();
        await this.s3.uploadFile(toS3Key('index.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'application/json');
    }
    async findVersion(serviceName, version) {
        const catalog = await this.buildCatalog();
        return (catalog.services
            .find((service) => service.name === serviceName)
            ?.versions.find((item) => item.version === version) ?? null);
    }
    async resolveSpecFile(serviceName, version) {
        const normalizedService = normalizeSegment(serviceName, 'Service name');
        const normalizedVersion = normalizeSegment(version, 'Version');
        for (const extension of ['json', 'yaml', 'yml']) {
            const key = toS3Key(`${normalizedService}/${normalizedVersion}/openapi.${extension}`);
            try {
                const text = await this.s3.getObjectText(key);
                return { key, extension, text };
            }
            catch {
                // try next extension
            }
        }
        return null;
    }
}
