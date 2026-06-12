import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  isS3NotFoundError,
  templateConfigConflictError,
  templateConfigNotFoundError,
  templateConfigValidationError,
} from './template-config-s3.errors';

export type TemplateConfigS3StoreOptions = {
  bucket?: string;
  prefix?: string;
  client?: S3Client;
};

export type TemplateConfigS3Document = {
  configId: string;
  document: Record<string, unknown>;
};

async function streamToString(body: unknown): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf-8');

  const stream = body as AsyncIterable<unknown>;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export function assertSafeConfigId(configId: string): string {
  const id = configId.trim();
  if (!id) {
    templateConfigValidationError('configId is required');
  }
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    templateConfigValidationError('configId must not contain path segments');
  }
  return id;
}

export class TemplateConfigS3Store {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: TemplateConfigS3StoreOptions = {}) {
    this.client =
      options.client ??
      new S3Client({
        region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
      });
    this.bucket = (options.bucket ?? process.env.TEMPLATE_CONFIG_S3_BUCKET ?? '').trim();
    this.prefix = (options.prefix ?? process.env.TEMPLATE_CONFIG_S3_PREFIX ?? 'template-configs')
      .trim()
      .replace(/^\/+|\/+$/g, '');

    if (!this.bucket) {
      templateConfigValidationError('TEMPLATE_CONFIG_S3_BUCKET is not configured');
    }
  }

  buildKey(configId: string): string {
    const safeId = assertSafeConfigId(configId);
    return `${this.prefix}/${safeId}.json`;
  }

  private configIdFromKey(key: string): string | undefined {
    const normalizedPrefix = `${this.prefix}/`;
    if (!key.startsWith(normalizedPrefix) || !key.endsWith('.json')) {
      return undefined;
    }
    const id = key.slice(normalizedPrefix.length, -'.json'.length);
    return id || undefined;
  }

  async exists(configId: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.buildKey(configId),
        }),
      );
      return true;
    } catch (e: unknown) {
      if (isS3NotFoundError(e)) return false;
      throw e;
    }
  }

  async create(configId: string, document: Record<string, unknown>): Promise<TemplateConfigS3Document> {
    const safeId = assertSafeConfigId(configId);
    const key = this.buildKey(safeId);

    if (await this.exists(safeId)) {
      templateConfigConflictError(`Template config already exists for id ${safeId}`);
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: `${JSON.stringify(document, null, 2)}\n`,
        ContentType: 'application/json',
      }),
    );

    return { configId: safeId, document };
  }

  async getById(configId: string): Promise<TemplateConfigS3Document> {
    const safeId = assertSafeConfigId(configId);
    const key = this.buildKey(safeId);

    try {
      const resp = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      const raw = await streamToString(resp.Body);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { configId: safeId, document: parsed };
    } catch (e: unknown) {
      if (isS3NotFoundError(e)) {
        templateConfigNotFoundError(`Template config not found for id ${safeId}`);
      }
      if (e instanceof SyntaxError) {
        templateConfigValidationError(`Invalid JSON stored for config id ${safeId}`);
      }
      throw e;
    }
  }

  async listAll(): Promise<TemplateConfigS3Document[]> {
    const items: TemplateConfigS3Document[] = [];
    let continuationToken: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${this.prefix}/`,
          ContinuationToken: continuationToken,
        }),
      );

      const keys =
        page.Contents?.map((entry) => entry.Key).filter(
          (key): key is string => Boolean(key?.endsWith('.json')),
        ) ?? [];

      for (const key of keys) {
        const configId = this.configIdFromKey(key);
        if (!configId) continue;
        items.push(await this.getById(configId));
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return items;
  }

  async replace(configId: string, document: Record<string, unknown>): Promise<TemplateConfigS3Document> {
    const safeId = assertSafeConfigId(configId);
    const key = this.buildKey(safeId);

    if (!(await this.exists(safeId))) {
      templateConfigNotFoundError(`Template config not found for id ${safeId}`);
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: `${JSON.stringify(document, null, 2)}\n`,
        ContentType: 'application/json',
      }),
    );

    return { configId: safeId, document };
  }
}
