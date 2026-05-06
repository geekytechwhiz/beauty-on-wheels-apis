import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoDbMetadataRegistryRepository } from '../repositories/dynamodb/metadata.repository.impl';
import { DynamoDbRelationRepository } from '../repositories/dynamodb/dynamodb-relation.repository';
import type { IMetadataRegistryRepository } from '../repositories/metadata-registry.repository.interface';
import type { IRelationRepository } from '../repositories/relation.repository.interface';

let dynamoContextPromise: Promise<{
  doc: ReturnType<typeof DynamoDBDocumentClient.from>;
  tableName: string;
  pkAttr: string;
  skAttr: string;
}> | null = null;
let metadataSingleton: IMetadataRegistryRepository | null = null;
let relationSingleton: IRelationRepository | null = null;

/**
 * Resolves the shared document client, table name, and key attribute names. If
 * `METADATA_REGISTRY_PK_ATTR` and `METADATA_REGISTRY_SK_ATTR` are both set, uses them; otherwise
 * calls DescribeTable once. Cached for the Lambda instance.
 */
export async function getMetadataRegistryDynamoContext(): Promise<{
  doc: ReturnType<typeof DynamoDBDocumentClient.from>;
  tableName: string;
  pkAttr: string;
  skAttr: string;
}> {
  if (dynamoContextPromise) {
    return dynamoContextPromise;
  }
  dynamoContextPromise = (async () => {
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

    const doc = DynamoDBDocumentClient.from(rawClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    return { doc, tableName: table, pkAttr, skAttr };
  })();
  return dynamoContextPromise;
}

/**
 * Shared DynamoDB document client and metadata registry repository (Lambda container reuse).
 * First call may DescribeTable when key env vars are not both set.
 */
export async function getMetadataRepository(): Promise<IMetadataRegistryRepository> {
  if (metadataSingleton) {
    return metadataSingleton;
  }
  const ctx = await getMetadataRegistryDynamoContext();
  metadataSingleton = new DynamoDbMetadataRegistryRepository(ctx.doc as never, ctx.tableName, {
    pkAttr: ctx.pkAttr,
    skAttr: ctx.skAttr,
  });
  return metadataSingleton;
}

/** Same table + client as {@link getMetadataRepository}; for `RELATION#…` and audit items. */
export async function getRelationRepository(): Promise<IRelationRepository> {
  if (relationSingleton) {
    return relationSingleton;
  }
  const ctx = await getMetadataRegistryDynamoContext();
  relationSingleton = new DynamoDbRelationRepository(ctx.doc as never, ctx.tableName, {
    pkAttr: ctx.pkAttr,
    skAttr: ctx.skAttr,
  });
  return relationSingleton;
}
