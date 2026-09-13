import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../configs/env.config';

const DEFAULT_EXPIRES_IN_SECONDS = 900;

export interface PresignedUpload {
  bucket: string;
  objectKey: string;
  uploadUrl: string;
}

export interface DocumentStorage {
  createObjectKey(vendorId: string, documentId: string, fileName: string): string;
  createUploadUrl(params: {
    objectKey: string;
    contentType: string;
  }): Promise<PresignedUpload>;
  createDownloadUrl(params: {
    bucket: string;
    objectKey: string;
  }): Promise<string | undefined>;
}

export class S3DocumentStorage implements DocumentStorage {
  constructor(
    private readonly bucket = env.DOCUMENTS_BUCKET_NAME,
    private readonly client = new S3Client({ region: env.AWS_REGION }),
  ) {}

  createObjectKey(vendorId: string, documentId: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `vendors/${vendorId}/documents/${documentId}/${safeName}`;
  }

  async createUploadUrl(params: {
    objectKey: string;
    contentType: string;
  }): Promise<PresignedUpload> {
    if (!this.bucket) {
      return {
        bucket: 'unconfigured',
        objectKey: params.objectKey,
        uploadUrl: '',
      };
    }

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        ContentType: params.contentType,
      }),
      { expiresIn: DEFAULT_EXPIRES_IN_SECONDS },
    );

    return {
      bucket: this.bucket,
      objectKey: params.objectKey,
      uploadUrl,
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
      { expiresIn: DEFAULT_EXPIRES_IN_SECONDS },
    );
  }
}

let storage: DocumentStorage;

export function getDocumentStorage(): DocumentStorage {
  if (!storage) {
    storage = new S3DocumentStorage();
  }
  return storage;
}
