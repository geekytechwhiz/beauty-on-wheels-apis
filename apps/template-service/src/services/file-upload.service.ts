import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getTemplateAppEnv } from '../config/env';

const env = getTemplateAppEnv();

const s3Client = new S3Client({
  region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? env.AWS_REGION_TEMPLATE_SERVICE ?? 'us-east-1',
});

export class S3Service {
  async generateUploadUrl(
    folder: string,
    fileName: string,
    contentType: string,
  ) {
    const key = `${folder}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: env.FILE_BUCKET || 'dev-mvx-developer-hub',
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300,
    });

    return {
      uploadUrl,
      key,
    };
  }
}

export const s3Service = new S3Service();
