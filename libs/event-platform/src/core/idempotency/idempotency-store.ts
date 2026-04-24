// idempotencyStore.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});

export interface IdempotencySaveOptions {
  ttlSeconds?: number;
}

/**
 * Key-only idempotency (EventConsumer). Mutually exclusive with "result" caching; same backing table.
 */
export interface IdempotencyStore {
  exists(key: string): Promise<boolean>;
  save(key: string, options?: IdempotencySaveOptions): Promise<void>;
}

type MiddlewareIdempotencyStore = {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown) => Promise<void>;
};

const TABLE = () => process.env.TABLE_NAME!;

const pk = (key: string) => `IDEMP#${key}` as const;

async function getItem(key: string): Promise<unknown | null> {
  const res = await client.send(
    new GetItemCommand({
      TableName: TABLE(),
      Key: { pk: { S: pk(key) } },
    })
  );
  if (!res.Item?.data?.S) {
    return null;
  }
  return JSON.parse(res.Item.data.S) as unknown;
}

async function putItem(
  key: string,
  data: unknown,
  ttlSeconds?: number
): Promise<void> {
  const baseTtl = Math.floor(Date.now() / 1000) + (ttlSeconds && ttlSeconds > 0 ? ttlSeconds : 3600);
  await client.send(
    new PutItemCommand({
      TableName: TABLE(),
      Item: {
        pk: { S: pk(key) },
        data: { S: JSON.stringify(data) },
        ttl: { N: `${baseTtl}` },
      },
    })
  );
}

/**
 * DynamoDB-backed idempotency: supports EventConsumer (`exists` / `save`) and
 * middleware idempotency (`get` / `set` with cached result).
 */
export const idempotencyStore: IdempotencyStore & MiddlewareIdempotencyStore = {
  get: (key: string) => getItem(key),

  set: (key: string, value: unknown) => putItem(key, value),

  async exists(key: string): Promise<boolean> {
    return (await getItem(key)) != null;
  },

  async save(key: string, options?: IdempotencySaveOptions): Promise<void> {
    if (await this.exists(key)) {
      return;
    }
    await putItem(key, { _idempotent: true }, options?.ttlSeconds);
  },
};
