import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbMetadataRegistryRepository, type IMetadataRegistryRepository } from '@api-hub/metadata';

let singleton: IMetadataRegistryRepository | null = null;
let initPromise: Promise<IMetadataRegistryRepository> | null = null;

/**
 * Builds the repository. If METADATA_REGISTRY_PK_ATTR and METADATA_REGISTRY_SK_ATTR are both set,
 * uses them; otherwise calls DescribeTable once to read HASH / RANGE attribute names from the
 * DevOps-provisioned table (no CloudFormation required).
 */
async function createRepository(): Promise<IMetadataRegistryRepository> {
  const table = process.env.METADATA_REGISTRY_TABLE;
  if (!table) {
    throw new Error('METADATA_REGISTRY_TABLE is not set');
  }
  const region = process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  const rawClient = new DynamoDBClient({ region });

  const pkEnv = process.env.METADATA_REGISTRY_PK_ATTR?.trim();
  const skEnv = process.env.METADATA_REGISTRY_SK_ATTR?.trim();

  let pkAttr: string;
  let skAttr: string;

  if (pkEnv && skEnv) {
    pkAttr = pkEnv;
    skAttr = skEnv;
  } else {
    const desc = await rawClient.send(new DescribeTableCommand({ TableName: table }));
    const keys = desc.Table?.KeySchema ?? [];
    const hash = keys.find((k) => k.KeyType === 'HASH');
    const range = keys.find((k) => k.KeyType === 'RANGE');
    if (!hash?.AttributeName || !range?.AttributeName) {
      throw new Error(
        `DynamoDB table "${table}" must have a partition key (HASH) and a sort key (RANGE). ` +
          `Current KeySchema: ${JSON.stringify(keys)}. This service expects a composite primary key.`,
      );
    }
    pkAttr = hash.AttributeName;
    skAttr = range.AttributeName;
  }

  const client = DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  return new DynamoDbMetadataRegistryRepository(client as never, table, {
    pkAttr,
    skAttr,
  });
}

/**
 * Shared DynamoDB document client and metadata registry repository (Lambda container reuse).
 * First call may DescribeTable when key env vars are not both set.
 */
export async function getMetadataRepository(): Promise<IMetadataRegistryRepository> {
  if (singleton) {
    return singleton;
  }
  if (!initPromise) {
    initPromise = createRepository().then((r) => {
      singleton = r;
      return r;
    });
  }
  return initPromise;
}
