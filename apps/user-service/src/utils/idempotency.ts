import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const IDEMPOTENCY_TABLE = process.env.IDEMPOTENCY_TABLE || 'UserServiceIdempotency';

export async function isIdempotent(key: string): Promise<boolean> {
  const result = await client.send(new GetItemCommand({
    TableName: IDEMPOTENCY_TABLE,
    Key: { id: { S: key } },
  }));
  return !!result.Item;
}

export async function markIdempotent(key: string): Promise<void> {
  await client.send(new PutItemCommand({
    TableName: IDEMPOTENCY_TABLE,
    Item: { id: { S: key }, createdAt: { S: new Date().toISOString() } },
  }));
}
