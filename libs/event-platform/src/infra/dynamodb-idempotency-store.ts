import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

import type { IdempotencyStore } from '../core/idempotency/store-idempotency.strategy';
import { isConditionalCheckFailure } from '../core/idempotency/utils';

const client = new DynamoDBClient({});

const TTL_SECONDS = 24 * 60 * 60; // 24 hours
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class DynamoDbIdempotencyStore implements IdempotencyStore {
  private readonly tableName: string;

  /**
   * @param tableName - When omitted, uses `process.env.IDEMPOTENCY_TABLE` (required in that case).
   */
  constructor(tableName?: string) {
    const t = tableName ?? process.env['IDEMPOTENCY_TABLE'];
    if (!t?.trim()) {
      throw new Error(
        'DynamoDbIdempotencyStore: pass tableName or set IDEMPOTENCY_TABLE',
      );
    }
    this.tableName = t.trim();
  }

  async claim(key: string) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    try {
      await client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: {
            pk: { S: key },
            status: { S: 'IN_PROGRESS' },
            updatedAt: { S: nowIso },
            ttl: { N: `${Math.floor(now / 1000) + TTL_SECONDS}` },
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );

      return 'ACQUIRED';
    } catch (err: unknown) {
      if (!isConditionalCheckFailure(err)) {
        throw err;
      }

      const existing = await client.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: { pk: { S: key } },
        }),
      );

      const status = existing.Item?.status?.S;
      const updatedAt = existing.Item?.updatedAt?.S;

      if (!status || !updatedAt) return 'DUPLICATE';

      if (status === 'COMPLETED') return 'DUPLICATE';

      const lastUpdate = new Date(updatedAt).getTime();

      if (now - lastUpdate > LOCK_TIMEOUT_MS) {
        const staleThresholdIso = new Date(now - LOCK_TIMEOUT_MS).toISOString();
        try {
          await client.send(
            new UpdateItemCommand({
              TableName: this.tableName,
              Key: { pk: { S: key } },
              UpdateExpression: 'SET updatedAt = :now',
              ConditionExpression: '#s = :inprog AND updatedAt < :staleBefore',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':inprog': { S: 'IN_PROGRESS' },
                ':staleBefore': { S: staleThresholdIso },
                ':now': { S: nowIso },
              },
            }),
          );
          return 'ACQUIRED';
        } catch (reclaimErr: unknown) {
          if (!isConditionalCheckFailure(reclaimErr)) {
            throw reclaimErr;
          }
          const recheck = await client.send(
            new GetItemCommand({
              TableName: this.tableName,
              Key: { pk: { S: key } },
            }),
          );
          const s2 = recheck.Item?.status?.S;
          if (s2 === 'COMPLETED') return 'DUPLICATE';
          return 'IN_PROGRESS';
        }
      }

      return 'IN_PROGRESS';
    }
  }

  async markCompleted(key: string) {
    await client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: { pk: { S: key } },
        UpdateExpression: 'SET #s = :s, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':s': { S: 'COMPLETED' },
          ':u': { S: new Date().toISOString() },
        },
      }),
    );
  }
}
