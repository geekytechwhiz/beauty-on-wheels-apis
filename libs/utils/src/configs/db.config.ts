import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Prefer the Lambda/runtime region first. Custom DEFAULT_REGION/DP_REGION
// overrides are only for local/offline when AWS_REGION is unset. Hardcoding
// us-east-1 (or preferring a stale DEFAULT_REGION) breaks stacks deployed
// elsewhere (e.g. ap-south-1) because IAM grants are scoped to the table ARN
// in the provider region.
const region =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  process.env.DEFAULT_REGION ||
  process.env.DP_REGION ||
  process.env.REGION ||
  'us-east-1';

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
