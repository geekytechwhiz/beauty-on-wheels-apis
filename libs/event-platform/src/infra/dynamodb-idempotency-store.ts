// infra/dynamodb-idempotency-store.ts

import {
    DynamoDBClient,
    PutItemCommand,
    GetItemCommand,
    UpdateItemCommand,
  } from '@aws-sdk/client-dynamodb';
  
  import type { IdempotencyStore } from '../core/idempotency/store-idempotency.strategy';
  
  const client = new DynamoDBClient({});
  
  const TABLE_NAME = process.env.IDEMPOTENCY_TABLE!;
  const TTL_SECONDS = 24 * 60 * 60; // 24 hours
  const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  
  export class DynamoDbIdempotencyStore implements IdempotencyStore {
    async claim(key: string) {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
  
      try {
        // 🔥 Atomic lock
        await client.send(
          new PutItemCommand({
            TableName: TABLE_NAME,
            Item: {
              pk: { S: key },
              status: { S: 'IN_PROGRESS' },
              updatedAt: { S: nowIso },
              ttl: { N: `${Math.floor(now / 1000) + TTL_SECONDS}` },
            },
            ConditionExpression: 'attribute_not_exists(pk)',
          })
        );
  
        return 'ACQUIRED';
      } catch (err: any) {
        if (err.name !== 'ConditionalCheckFailedException') {
          throw err;
        }
  
        // 🔥 Already exists → check state
        const existing = await client.send(
          new GetItemCommand({
            TableName: TABLE_NAME,
            Key: { pk: { S: key } },
          })
        );
  
        const status = existing.Item?.status?.S;
        const updatedAt = existing.Item?.updatedAt?.S;
  
        if (!status || !updatedAt) return 'DUPLICATE';
  
        // 🔥 Completed → safe duplicate
        if (status === 'COMPLETED') return 'DUPLICATE';
  
        // 🔥 IN_PROGRESS → check timeout
        const lastUpdate = new Date(updatedAt).getTime();
  
        if (now - lastUpdate > LOCK_TIMEOUT_MS) {
          // treat as retry
          return 'ACQUIRED';
        }
  
        return 'IN_PROGRESS';
      }
    }
  
    async markCompleted(key: string) {
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { pk: { S: key } },
          UpdateExpression: 'SET #s = :s, updatedAt = :u',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':s': { S: 'COMPLETED' },
            ':u': { S: new Date().toISOString() },
          },
        })
      );
    }
  }