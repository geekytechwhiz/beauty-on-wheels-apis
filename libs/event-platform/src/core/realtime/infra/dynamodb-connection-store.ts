import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createLogger } from '@api-hub/observability';

import type { ConnectionStore } from '../interfaces/connection-store.interface';
import { connectionPk, connectionSk } from './connection-keys';
import type { SocketConnectionRecord } from '../types/socket-connection-record.type';

const logger = createLogger({ service: 'dynamodb-connection-store' });

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DESTINATION_INDEX = 'DestinationIndex';
const BATCH_WRITE_LIMIT = 25;

export type DynamoDbConnectionStoreOptions = {
  tableName?: string;
  destinationIndexName?: string;
  ttlSeconds?: number;
  client?: DynamoDBClient;
};

export class DynamoDbConnectionStore implements ConnectionStore {
  private readonly client: DynamoDBClient;
  private readonly tableName: string;
  private readonly destinationIndexName: string;
  private readonly ttlSeconds: number;

  constructor(options: DynamoDbConnectionStoreOptions = {}) {
    const tableName =
      (typeof options.tableName === 'string' && options.tableName.trim()) ||
      (typeof process.env.REALTIME_CONNECTIONS_TABLE === 'string' &&
        process.env.REALTIME_CONNECTIONS_TABLE.trim()) ||
      '';

    if (!tableName) {
      throw new Error(
        'DynamoDbConnectionStore: pass tableName or set REALTIME_CONNECTIONS_TABLE',
      );
    }

    this.tableName = tableName;
    this.destinationIndexName = options.destinationIndexName ?? DESTINATION_INDEX;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.client = options.client ?? new DynamoDBClient({});
  }

  async registerSubscriptions(input: {
    connectionId: string;
    destinations: string[];
  }): Promise<void> {
    const connectionId = input.connectionId.trim();
    const uniqueDestinations = [
      ...new Set(input.destinations.map((d) => d.trim()).filter(Boolean)),
    ];

    if (!connectionId || uniqueDestinations.length === 0) {
      return;
    }

    const now = Date.now();
    const connectedAt = new Date(now).toISOString();
    const ttl = Math.floor(now / 1000) + this.ttlSeconds;

    const items = uniqueDestinations.map((destination) => ({
      pk: connectionPk(connectionId),
      sk: connectionSk(destination),
      destination,
      connectionId,
      connectedAt,
      ttl,
    }));

    for (let i = 0; i < items.length; i += BATCH_WRITE_LIMIT) {
      const chunk = items.slice(i, i + BATCH_WRITE_LIMIT);
      await this.client.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: chunk.map((item) => ({
              PutRequest: { Item: marshall(item, { removeUndefinedValues: true }) },
            })),
          },
        }),
      );
    }

    logger.info({
      event: 'realtime.connection.registered',
      message: 'WebSocket connection subscriptions registered',
      connectionId,
      destinationCount: uniqueDestinations.length,
    });
  }

  async unregisterConnection(connectionId: string): Promise<void> {
    const trimmed = connectionId.trim();
    if (!trimmed) {
      return;
    }

    const records = await this.listConnectionRecords(trimmed);
    if (records.length === 0) {
      return;
    }

    for (let i = 0; i < records.length; i += BATCH_WRITE_LIMIT) {
      const chunk = records.slice(i, i + BATCH_WRITE_LIMIT);
      await this.client.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: chunk.map((record) => ({
              DeleteRequest: {
                Key: marshall({ pk: record.pk, sk: record.sk }),
              },
            })),
          },
        }),
      );
    }

    logger.info({
      event: 'realtime.connection.unregistered',
      message: 'WebSocket connection subscriptions removed',
      connectionId: trimmed,
      removedCount: records.length,
    });
  }

  async resolveConnections(destination: string): Promise<string[]> {
    const trimmed = destination.trim();
    if (!trimmed) {
      return [];
    }

    const connectionIds = new Set<string>();
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: this.destinationIndexName,
          KeyConditionExpression: '#destination = :destination',
          ExpressionAttributeNames: { '#destination': 'destination' },
          ExpressionAttributeValues: marshall({ ':destination': trimmed }),
          ProjectionExpression: 'connectionId',
          ExclusiveStartKey: lastEvaluatedKey
            ? marshall(lastEvaluatedKey)
            : undefined,
        }),
      );

      for (const item of result.Items ?? []) {
        const row = unmarshall(item) as Pick<SocketConnectionRecord, 'connectionId'>;
        if (typeof row.connectionId === 'string' && row.connectionId.trim()) {
          connectionIds.add(row.connectionId.trim());
        }
      }

      lastEvaluatedKey = result.LastEvaluatedKey
        ? (unmarshall(result.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastEvaluatedKey);

    return [...connectionIds];
  }

  private async listConnectionRecords(connectionId: string): Promise<SocketConnectionRecord[]> {
    const records: SocketConnectionRecord[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'pk' },
          ExpressionAttributeValues: marshall({ ':pk': connectionPk(connectionId) }),
          ExclusiveStartKey: lastEvaluatedKey
            ? marshall(lastEvaluatedKey)
            : undefined,
        }),
      );

      for (const item of result.Items ?? []) {
        records.push(unmarshall(item) as SocketConnectionRecord);
      }

      lastEvaluatedKey = result.LastEvaluatedKey
        ? (unmarshall(result.LastEvaluatedKey) as Record<string, unknown>)
        : undefined;
    } while (lastEvaluatedKey);

    return records;
  }
}

export function createDynamoDbConnectionStore(
  options?: DynamoDbConnectionStoreOptions,
): DynamoDbConnectionStore {
  return new DynamoDbConnectionStore(options);
}
