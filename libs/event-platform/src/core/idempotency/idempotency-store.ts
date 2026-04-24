// idempotencyStore.ts

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});

export const idempotencyStore = {
  get: async (key: string) => {
    const res = await client.send(
      new GetItemCommand({
        TableName: process.env.TABLE_NAME!,
        Key: {
          pk: { S: `IDEMP#${key}` },
        },
      })
    );

    return res.Item ? JSON.parse(res.Item.data.S!) : null;
  },

  set: async (key: string, value: any) => {
    await client.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME!,
        Item: {
          pk: { S: `IDEMP#${key}` },
          data: { S: JSON.stringify(value) },
          ttl: { N: `${Math.floor(Date.now() / 1000) + 3600}` },
        },
      })
    );
  },
};