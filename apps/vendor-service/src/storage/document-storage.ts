/* eslint-disable mvrx/no-direct-dynamodb */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../configs/env.config';
import { DocumentStorageError } from '../errors';

export interface PresignedUpload {
  bucket: string;
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface StoredObjectHead {
  contentType?: string;
  contentLength?: number;
}

export interface DocumentStorage {
  createUploadUrl(params: {
    objectKey: string;
    contentType: string;
    fileSize?: number;
  }): Promise<PresignedUpload>;
  createDownloadUrl(params: {
    bucket: string;
    objectKey: string;
  }): Promise<string | undefined>;
  headObject(params: {
    bucket: string;
    objectKey: string;
  }): Promise<StoredObjectHead | null>;
  readPrefix(params: {
    bucket: string;
    objectKey: string;
    bytes: number;
  }): Promise<Uint8Array>;
  deleteObject(params: { bucket: string; objectKey: string }): Promise<void>;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const name = 'name' in error ? String(error.name) : '';
  const status =
    '$metadata' in error
      ? (
          error as {
            $metadata?: { httpStatusCode?: number };
          }
        ).$metadata?.httpStatusCode
      : undefined;

  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

export class S3DocumentStorage implements DocumentStorage {
  constructor(
    private readonly bucket = env.DOCUMENT_BUCKET,
    private readonly uploadExpiresIn = env.DOCUMENT_UPLOAD_URL_EXPIRY,
    private readonly downloadExpiresIn = env.DOCUMENT_DOWNLOAD_URL_EXPIRY,
    private readonly client = new S3Client({
      region: env.AWS_REGION,

      // Prevent optional SDK-generated CRC32 checksums
      // from being added to presigned upload requests.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    }),
  ) {}

  private requireBucket(bucket = this.bucket): string {
    if (!bucket || bucket === 'unconfigured') {
      throw new DocumentStorageError('Document storage is not configured');
    }
    return bucket;
  }

  async createUploadUrl(params: {
    objectKey: string;
    contentType: string;
    fileSize?: number;
  }): Promise<PresignedUpload> {
    const bucket = this.requireBucket();

    // File size must be validated by the application
    // before generating the presigned URL.
    // Do not sign ContentLength because it can cause
    // SignatureDoesNotMatch during direct uploads.

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: params.objectKey,
      ContentType: params.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.uploadExpiresIn,
    });

    return {
      bucket,
      objectKey: params.objectKey,
      uploadUrl,
      expiresIn: this.uploadExpiresIn,
    };
  }

  async createDownloadUrl(params: {
    bucket: string;
    objectKey: string;
  }): Promise<string | undefined> {
    if (!params.bucket || params.bucket === 'unconfigured') {
      return undefined;
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: params.bucket,
        Key: params.objectKey,
      }),
      { expiresIn: this.downloadExpiresIn },
    );
  }

  async headObject(params: {
    bucket: string;
    objectKey: string;
  }): Promise<StoredObjectHead | null> {
    const bucket = this.requireBucket(params.bucket);

    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: params.objectKey,
        }),
      );

      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
      };
    } catch (error) {
      if (isMissingObject(error)) {
        return null;
      }

      throw new DocumentStorageError('Unable to verify the uploaded document');
    }
  }

  async readPrefix(params: {
    bucket: string;
    objectKey: string;
    bytes: number;
  }): Promise<Uint8Array> {
    const bucket = this.requireBucket(params.bucket);

    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: params.objectKey,
          Range: `bytes=0-${Math.max(params.bytes - 1, 0)}`,
        }),
      );

      if (!result.Body) {
        throw new DocumentStorageError('Uploaded document has no content');
      }

      return result.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof DocumentStorageError) {
        throw error;
      }

      if (isMissingObject(error)) {
        throw new DocumentStorageError('Uploaded document was not found');
      }

      throw new DocumentStorageError('Unable to inspect the uploaded document');
    }
  }

  async deleteObject(params: {
    bucket: string;
    objectKey: string;
  }): Promise<void> {
    const bucket = this.requireBucket(params.bucket);

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: params.objectKey,
        }),
      );
    } catch (error) {
      if (isMissingObject(error)) {
        return;
      }

      throw new DocumentStorageError('Unable to remove the stored document');
    }
  }
}

let storage: DocumentStorage;

export function getDocumentStorage(): DocumentStorage {
  if (!storage) {
    storage = new S3DocumentStorage();
  }

  return storage;
}
