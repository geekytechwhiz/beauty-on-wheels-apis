import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});
const PRESIGN_EXPIRES_SECONDS = 300;

export interface Yes3FileObject {
  key: string;
  fileName: string;
  contentType: string;
  size: number;
  lastModified?: string;
}

export class S3Service {
  private buildKey(folder: string, fileName: string): string {
    const normalizedFolder = folder.trim().replace(/^\/+|\/+$/g, '');
    const normalizedFileName = fileName.trim().replace(/^\/+/, '');
    return `${normalizedFolder}/${normalizedFileName}`;
  }

  async generateUploadUrl(
    folder: string,
    fileName: string,
    contentType: string,
  ) {
    const key = this.buildKey(folder, fileName);

    const command = new PutObjectCommand({
      Bucket: process.env.FILE_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });

    return {
      uploadUrl,
      key,
    };
  }

  async generateDownloadUrl(folder: string, fileName: string) {
    const key = this.buildKey(folder, fileName);

    const command = new GetObjectCommand({
      Bucket: process.env.FILE_BUCKET,
      Key: key,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });

    return {
      downloadUrl,
      key,
    };
  }

  async listFiles(folder: string): Promise<Yes3FileObject[]> {
    const normalizedFolder = folder.trim().replace(/^\/+|\/+$/g, '');
    const prefix = `${normalizedFolder}/`;

    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.FILE_BUCKET,
        Prefix: prefix,
      }),
    );

    return (
      result.Contents?.filter(
        (item) => item.Key && !item.Key.endsWith('/'),
      ).map((item) => ({
        key: item.Key!,
        fileName: item.Key!.slice(prefix.length),
        contentType: '',
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString(),
      })) ?? []
    );
  }
}

export const s3Service = new S3Service();
