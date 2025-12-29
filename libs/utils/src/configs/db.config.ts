import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const DYNAMODB_CONFIG = {
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  maxAttempts: Number(process.env.DYNAMODB_MAX_ATTEMPTS) || 3,
  retryMode: process.env.DYNAMODB_RETRY_MODE || 'standard',
};

export const ddbClient = new DynamoDBClient(DYNAMODB_CONFIG);
export const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
