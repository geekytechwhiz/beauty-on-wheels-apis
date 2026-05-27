import {
    S3Client,
    PutObjectCommand
  } from "@aws-sdk/client-s3";
  
  import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
  
  const s3Client = new S3Client({
    region: process.env.AWS_REGION
  });
  
  export class S3Service {
  
    async generateUploadUrl(
      folder: string,
      fileName: string,
      contentType: string
    ) {
      const key = `${folder}/${fileName}`;
  
      const command = new PutObjectCommand({
        Bucket: process.env.FILE_BUCKET,
        Key: key,
        ContentType: contentType
      });
  
      const uploadUrl = await getSignedUrl(
        s3Client,
        command,
        {
          expiresIn: 300
        }
      );
  
      return {
        uploadUrl,
        key
      };
    }
  }
  
  export const s3Service = new S3Service();