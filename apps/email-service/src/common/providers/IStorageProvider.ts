export interface GenerateUploadUrlOptions {
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds: number;
}

export interface PutObjectOptions {
  bucket: string;
  key: string;
  body: Buffer | string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResponse {
  body: string;
  metadata?: Record<string, string>;
  contentType?: string;
}

export interface IStorageProvider {
  putObject(options: PutObjectOptions): Promise<void>;
  getObject(bucket: string, key: string): Promise<GetObjectResponse>;
  getObjectAsBuffer(bucket: string, key: string): Promise<Buffer>;
  generatePresignedUploadUrl(options: GenerateUploadUrlOptions): Promise<string>;
}
