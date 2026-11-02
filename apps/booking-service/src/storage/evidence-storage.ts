/* eslint-disable mvrx/no-direct-dynamodb */
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../configs/env.config';
import { BookingError } from '../errors';

export const EVIDENCE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function extensionForContentType(contentType: string): string {
  return EXTENSION[contentType] ?? 'bin';
}

export interface EvidenceUpload {
  uploadUrl: string;
  objectKey: string;
  expiresAt: string;
}

export interface StoredEvidenceHead {
  contentType?: string;
  contentLength?: number;
}

/**
 * Presigned-upload storage for visit evidence and issue attachments.
 * Binary content never passes through Lambda or DynamoDB; only object keys are stored.
 */
export interface EvidenceStorage {
  isConfigured(): boolean;
  createUploadUrl(params: { objectKey: string; contentType: string }): Promise<EvidenceUpload>;
  headObject(objectKey: string): Promise<StoredEvidenceHead | null>;
}

export function storageNotConfigured(): BookingError {
  return new BookingError(
    'EVIDENCE_STORAGE_NOT_CONFIGURED',
    'Evidence storage is not configured for this environment (EVIDENCE_BUCKET is unset).',
    501,
    undefined,
    false,
  );
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name: unknown }).name) : '';
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

export class S3EvidenceStorage implements EvidenceStorage {
  constructor(
    private readonly bucket: string = env.EVIDENCE_BUCKET,
    private readonly expiresIn: number = env.EVIDENCE_UPLOAD_URL_EXPIRY,
    private readonly client: S3Client = new S3Client({
      region: env.AWS_REGION,
      // Keep optional SDK checksums out of presigned PUT requests.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
    private readonly now: () => Date = () => new Date(),
  ) {}

  isConfigured(): boolean {
    return Boolean(this.bucket) && this.bucket !== 'unconfigured';
  }

  async createUploadUrl(params: { objectKey: string; contentType: string }): Promise<EvidenceUpload> {
    if (!this.isConfigured()) throw storageNotConfigured();
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: params.objectKey, ContentType: params.contentType }),
      { expiresIn: this.expiresIn },
    );
    return {
      uploadUrl,
      objectKey: params.objectKey,
      expiresAt: new Date(this.now().getTime() + this.expiresIn * 1000).toISOString(),
    };
  }

  async headObject(objectKey: string): Promise<StoredEvidenceHead | null> {
    if (!this.isConfigured()) throw storageNotConfigured();
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return { contentType: result.ContentType, contentLength: result.ContentLength };
    } catch (error) {
      if (isMissing(error)) return null;
      throw new BookingError(
        'EVIDENCE_STORAGE_ERROR',
        'Unable to verify the uploaded evidence',
        502,
        undefined,
        true,
      );
    }
  }
}

let storage: EvidenceStorage | undefined;

export function getEvidenceStorage(): EvidenceStorage {
  if (!storage) storage = new S3EvidenceStorage();
  return storage;
}
