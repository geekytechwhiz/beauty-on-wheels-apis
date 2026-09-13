import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  IStorageProvider,
  PutObjectOptions,
  GetObjectResponse,
  GenerateUploadUrlOptions,
} from '../IStorageProvider.js';
import { logger } from '../../utils/logger.js';
import { Readable } from 'stream';

import { environment } from '../../config/environment.js';

export class S3StorageProvider implements IStorageProvider {
  private client: S3Client;

  constructor(region: string) {
    const config: any = { region };
    if (environment.isOffline) {
      config.endpoint = environment.s3Endpoint;
      config.forcePathStyle = true;
      config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
    }
    this.client = new S3Client(config);
  }

  async putObject(options: PutObjectOptions): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: options.key,
        Body: options.body,
        ContentType: options.contentType,
        Metadata: options.metadata,
      });
      await this.client.send(command);
    } catch (error) {
      logger.error('Error uploading file to S3', {
        error,
        bucket: options.bucket,
        key: options.key,
      });
      throw error;
    }
  }

  async getObject(bucket: string, key: string): Promise<GetObjectResponse> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error(`S3 Object body is empty: s3://${bucket}/${key}`);
      }

      let bodyString = '';
      if (typeof response.Body.transformToString === 'function') {
        bodyString = await response.Body.transformToString();
      } else {
        bodyString = await this.streamToString(response.Body as Readable);
      }

      return {
        body: bodyString,
        metadata: response.Metadata,
        contentType: response.ContentType,
      };
    } catch (error) {
      logger.error('Error fetching file from S3', { error, bucket, key });
      throw error;
    }
  }

  async getObjectAsBuffer(bucket: string, key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error(`S3 Object body is empty: s3://${bucket}/${key}`);
      }

      const chunks: Uint8Array[] = [];
      const stream = response.Body as Readable;

      return new Promise<Buffer>((resolve, reject) => {
        stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    } catch (error) {
      logger.error('Error fetching S3 object as Buffer', { error, bucket, key });
      throw error;
    }
  }

  async generatePresignedUploadUrl(options: GenerateUploadUrlOptions): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: options.key,
        ContentType: options.contentType,
      });
      return await getSignedUrl(this.client, command, { expiresIn: options.expiresInSeconds });
    } catch (error) {
      logger.error('Error generating presigned S3 URL', {
        error,
        bucket: options.bucket,
        key: options.key,
      });
      throw error;
    }
  }

  private streamToString(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }
}
