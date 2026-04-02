import { CopyObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { GenerateTemplateStorageKeyParams, TemplateStorage } from '../../application';
import { TtlJsonCache } from './json-cache';
import { generateS3Key } from './s3-path';

export interface S3TemplateStorageOptions {
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
}

async function readObjectBody(
  body: { transformToString?: () => Promise<string> } | undefined,
): Promise<string> {
  if (!body?.transformToString) {
    throw new Error('S3 object body is empty');
  }
  return body.transformToString();
}

export class S3TemplateStorage implements TemplateStorage {
  private readonly cache: TtlJsonCache<unknown>;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    options?: S3TemplateStorageOptions,
  ) {
    if (!bucket) {
      throw new Error('TEMPLATE_BUCKET is not configured');
    }
    this.cache = new TtlJsonCache(options?.cacheTtlMs ?? 60_000, options?.cacheMaxEntries ?? 500);
  }

  generateKey(params: GenerateTemplateStorageKeyParams): string {
    return generateS3Key(params);
  }

  async uploadTemplate(key: string, json: unknown): Promise<void> {
    const body = JSON.stringify(json);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
      }),
    );
    this.cache.set(key, JSON.parse(body) as unknown);
  }

  async getTemplate(key: string): Promise<unknown> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const raw = await readObjectBody(res.Body as { transformToString?: () => Promise<string> });
    const parsed = JSON.parse(raw) as unknown;
    this.cache.set(key, parsed);
    return parsed;
  }

  async copyTemplateToSnapshot(
    sourceKey: string,
    params: { templateId: string; version: string; snapshotId: string },
  ): Promise<string> {
    const destKey = `snapshots/${params.templateId}/${params.version}/${params.snapshotId}.json`;
    const copySource = `${this.bucket}/${encodeURIComponent(sourceKey)}`;
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: copySource,
        Key: destKey,
        ContentType: 'application/json',
        MetadataDirective: 'COPY',
      }),
    );
    return destKey;
  }
}
