import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const region = process.env.DEFAULT_REGION || process.env.DP_REGION || 'us-east-1';

const config: DynamoDBClientConfig = {
  region,
};

export const ddbClient = new DynamoDBClient(config);

export const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});


