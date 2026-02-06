import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ConnectionContext } from '../models/connectionContext';

const dynamo = DynamoDBDocumentClient.create(
  new DynamoDBClient({ region: process.env.REGION ?? 'us-east-1' })
);
const tableName = process.env.WEBSOCKET_CONNECTION_TABLE ?? '';

export async function saveConnection(connection: ConnectionContext): Promise<void> {
  if (!tableName) return;
  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        connectionId: connection.connectionId,
        userId: connection.userId,
        orgId: connection.orgId,
        roles: connection.roles,
        connectedAt: connection.connectedAt,
        ttl: connection.ttl,
      },
    })
  );
}

export async function deleteConnection(connectionId: string): Promise<void> {
  if (!tableName) return;
  await dynamo.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { connectionId },
    })
  );
}

export async function findConnectionsByOrgId(orgId: string): Promise<Pick<ConnectionContext, 'connectionId'>[]> {
  if (!tableName) return [];
  const result = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'by-orgId',
      KeyConditionExpression: 'orgId = :orgId',
      ExpressionAttributeValues: { ':orgId': orgId },
      ProjectionExpression: 'connectionId',
    })
  );
  return (result.Items ?? []) as Pick<ConnectionContext, 'connectionId'>[];
}
