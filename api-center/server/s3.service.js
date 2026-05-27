import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const OPENAPI_FILE_PATTERN = /^([^/]+)\/([^/]+)\/openapi\.(json|yaml|yml)$/i;
function env(name, fallback = '') {
    return (process.env[name] ?? fallback).trim();
}
export function getS3Bucket() {
    return env('S3_BUCKET', 'dev-mvx-developer-hub');
}
export function getS3AppPrefix() {
    return env('S3_APP_PREFIX', 'uploads').replace(/^\/+|\/+$/g, '');
}
export function getSpecsPrefix() {
    return env('SPECS_PREFIX', 'api-specs').replace(/^\/+|\/+$/g, '');
}
export function getS3SpecsRoot() {
    const app = getS3AppPrefix();
    const specs = getSpecsPrefix();
    return app ? `${app}/${specs}` : specs;
}
export function toS3Key(relativeSpecPath) {
    return `${getS3SpecsRoot()}/${relativeSpecPath.replace(/^\/+/, '')}`;
}
export function toCatalogKey(relativeSpecPath) {
    return `${getSpecsPrefix()}/${relativeSpecPath.replace(/^\/+/, '')}`;
}
export function assertS3Configured() {
    if (!getS3Bucket()) {
        throw new Error('S3_BUCKET is required when S3 spec store is enabled.');
    }
}
class S3Service {
    s3;
    bucketName;
    constructor() {
        assertS3Configured();
        this.bucketName = getS3Bucket();
        this.s3 = new S3Client({
            region: env('AWS_REGION', 'us-east-1'),
        });
    }
    getBucketName() {
        return this.bucketName;
    }
    async uploadFile(key, body, contentType) {
        await this.s3.send(new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ContentType: contentType,
            CacheControl: 'no-cache,no-store,must-revalidate',
        }));
        return { success: true, key };
    }
    async getObjectText(key) {
        const response = await this.s3.send(new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        }));
        return response.Body.transformToString('utf8');
    }
    async getFileDetails(key) {
        const response = await this.s3.send(new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        }));
        return {
            contentType: response.ContentType,
            size: response.ContentLength,
            lastModified: response.LastModified,
            etag: response.ETag,
        };
    }
    async getSignedDownloadUrl(key, expiresIn = 3600) {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        });
        return getSignedUrl(this.s3, command, { expiresIn });
    }
    async getSignedUploadUrl(key, contentType, expiresIn = 3600) {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            ContentType: contentType,
            // CacheControl: 'no-cache,no-store,must-revalidate',
        });
        return getSignedUrl(this.s3, command, { expiresIn });
    }
    async deleteFile(key) {
        await this.s3.send(new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        }));
        return { success: true, deletedKey: key };
    }
    async listSpecObjects() {
        const prefix = `${getS3SpecsRoot()}/`;
        const objects = [];
        let continuationToken;
        do {
            const response = await this.s3.send(new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }));
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
}
let instance = null;
export function getS3Service() {
    if (!instance) {
        instance = new S3Service();
    }
    return instance;
}
export default getS3Service;
