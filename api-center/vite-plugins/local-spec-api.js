import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
const SPEC_STATUS = 'x-api-center-status';
function normalizePrefix(value) {
    return (value || 'specs').replace(/^\/+|\/+$/g, '');
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
function getContentType(extension) {
    switch (extension) {
        case 'json':
            return 'application/json';
        case 'yaml':
        case 'yml':
            return 'application/yaml';
    }
}
function getFileExtension(fileName) {
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
function parseOpenApiText(rawText, extension) {
    const parsedSpec = extension === 'json' ? JSON.parse(rawText) : yaml.load(rawText);
    if (!parsedSpec || typeof parsedSpec !== 'object' || Array.isArray(parsedSpec)) {
        throw new Error('The OpenAPI document must be a YAML or JSON object.');
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
    return yaml.dump(nextSpec, {
        noRefs: true,
        lineWidth: 120,
    });
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}
function sendError(res, status, message) {
    sendJson(res, status, { error: message });
}
export function localSpecApiPlugin(options) {
    const specsPrefix = normalizePrefix(options.specsPrefix);
    return {
        name: 'local-spec-api',
        configureServer(server) {
            if (!options.enabled) {
                return;
            }
            const rootDir = server.config.root;
            server.middlewares.use((req, res, next) => {
                const url = req.url?.split('?')[0] ?? '';
                if (!url.startsWith('/__api-center/specs')) {
                    next();
                    return;
                }
                void (async () => {
                    try {
                        const { writeSpecIndexFile } = await import(pathToFileURL(path.join(rootDir, 'scripts', 'generate-spec-index.mjs')).href);
                        const pathname = url.replace('/__api-center/specs', '') || '/';
                        if (req.method === 'POST' && pathname === '/upload') {
                            const raw = await readBody(req);
                            const body = JSON.parse(raw);
                            const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
                            const version = normalizeSegment(body.version ?? '', 'Version');
                            const fileName = body.fileName?.trim();
                            const contentBase64 = body.contentBase64;
                            if (!fileName || !contentBase64) {
                                sendError(res, 400, 'fileName and contentBase64 are required.');
                                return;
                            }
                            const extension = getFileExtension(fileName);
                            if (!extension) {
                                sendError(res, 400, 'Only .yaml, .yml, and .json files are supported.');
                                return;
                            }
                            const text = Buffer.from(contentBase64, 'base64').toString('utf8');
                            const parsed = parseOpenApiText(text, extension);
                            const openapiValue = parsed.openapi;
                            if (typeof openapiValue !== 'string' || openapiValue.trim() === '') {
                                sendError(res, 400, 'The OpenAPI document must include a valid `openapi` version field.');
                                return;
                            }
                            const infoValue = parsed.info;
                            if (!infoValue || typeof infoValue !== 'object' || Array.isArray(infoValue)) {
                                sendError(res, 400, 'The OpenAPI document must include an `info` object.');
                                return;
                            }
                            const outDir = path.join(rootDir, 'public', specsPrefix, serviceName, version);
                            fs.mkdirSync(outDir, { recursive: true });
                            const outPath = path.join(outDir, `openapi.${extension}`);
                            const normalizedText = serializeSpecWithStatus(parsed, extension, 'approved');
                            fs.writeFileSync(outPath, normalizedText, 'utf8');
                            writeSpecIndexFile({ rootDir, specsPrefix });
                            const relKey = `${specsPrefix}/${serviceName}/${version}/openapi.${extension}`;
                            sendJson(res, 200, {
                                serviceName,
                                version,
                                key: relKey,
                                extension,
                                contentType: getContentType(extension),
                                status: 'approved',
                            });
                            return;
                        }
                        if (req.method === 'POST' && pathname === '/delete') {
                            const raw = await readBody(req);
                            const body = JSON.parse(raw);
                            const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
                            const version = normalizeSegment(body.version ?? '', 'Version');
                            const dir = path.join(rootDir, 'public', specsPrefix, serviceName, version);
                            if (body.key) {
                                const rel = body.key.replace(/^\/+/, '');
                                const abs = path.join(rootDir, 'public', rel);
                                if (fs.existsSync(abs)) {
                                    fs.unlinkSync(abs);
                                }
                            }
                            else {
                                for (const ext of ['json', 'yaml', 'yml']) {
                                    const candidate = path.join(dir, `openapi.${ext}`);
                                    if (fs.existsSync(candidate)) {
                                        fs.unlinkSync(candidate);
                                    }
                                }
                            }
                            writeSpecIndexFile({ rootDir, specsPrefix });
                            sendJson(res, 200, { ok: true });
                            return;
                        }
                        if (req.method === 'POST' && pathname === '/save-edited') {
                            const raw = await readBody(req);
                            const body = JSON.parse(raw);
                            const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
                            const version = normalizeSegment(body.version ?? '', 'Version');
                            const yamlText = body.yamlText;
                            if (typeof yamlText !== 'string') {
                                sendError(res, 400, 'yamlText is required.');
                                return;
                            }
                            const outDir = path.join(rootDir, 'public', specsPrefix, serviceName, version);
                            if (fs.existsSync(outDir)) {
                                for (const name of ['openapi.json', 'openapi.yaml', 'openapi.yml']) {
                                    if (fs.existsSync(path.join(outDir, name))) {
                                        sendError(res, 400, `Version ${version} already exists for ${serviceName}.`);
                                        return;
                                    }
                                }
                            }
                            const parsed = parseOpenApiText(yamlText, 'yaml');
                            fs.mkdirSync(outDir, { recursive: true });
                            const outPath = path.join(outDir, 'openapi.yaml');
                            fs.writeFileSync(outPath, serializeSpecWithStatus(parsed, 'yaml', 'approved'), 'utf8');
                            writeSpecIndexFile({ rootDir, specsPrefix });
                            const relKey = `${specsPrefix}/${serviceName}/${version}/openapi.yaml`;
                            sendJson(res, 200, {
                                serviceName,
                                version,
                                key: relKey,
                                extension: 'yaml',
                                contentType: getContentType('yaml'),
                                status: 'approved',
                            });
                            return;
                        }
                        if (req.method === 'PATCH' && pathname === '/status') {
                            const raw = await readBody(req);
                            const body = JSON.parse(raw);
                            const serviceName = normalizeSegment(body.serviceName ?? '', 'Service name');
                            const version = normalizeSegment(body.version ?? '', 'Version');
                            const status = body.status;
                            if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
                                sendError(res, 400, 'status must be pending, approved, or rejected.');
                                return;
                            }
                            const dir = path.join(rootDir, 'public', specsPrefix, serviceName, version);
                            let filePath = null;
                            let extension = null;
                            for (const ext of ['json', 'yaml', 'yml']) {
                                const candidate = path.join(dir, `openapi.${ext}`);
                                if (fs.existsSync(candidate)) {
                                    filePath = candidate;
                                    extension = ext;
                                    break;
                                }
                            }
                            if (!filePath || !extension) {
                                sendError(res, 404, 'OpenAPI file not found for this service/version.');
                                return;
                            }
                            const rawText = fs.readFileSync(filePath, 'utf8');
                            const parsed = parseOpenApiText(rawText, extension);
                            fs.writeFileSync(filePath, serializeSpecWithStatus(parsed, extension, status), 'utf8');
                            writeSpecIndexFile({ rootDir, specsPrefix });
                            const relKey = `${specsPrefix}/${serviceName}/${version}/openapi.${extension}`;
                            sendJson(res, 200, {
                                serviceName,
                                version,
                                key: relKey,
                                extension,
                                contentType: getContentType(extension),
                                status,
                            });
                            return;
                        }
                        sendError(res, 404, 'Not found.');
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : 'Request failed.';
                        sendError(res, 400, message);
                    }
                })();
            });
        },
    };
}
