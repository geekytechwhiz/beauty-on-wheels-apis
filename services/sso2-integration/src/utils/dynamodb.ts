// ─────────────────────────────────────────────────────────────────────────────
// DYNAMODB CLIENT  +  TYPED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { fromEnv } from "@aws-sdk/credential-providers";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  GetCommandInput,
  PutCommandInput,
  UpdateCommandInput,
  DeleteCommandInput,
  QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";

// ── Singleton DynamoDB Document Client ───────────────────────────────────────
// Credentials are loaded from environment variables:
//   AWS_ACCESS_KEY_ID     — set in .env file
//   AWS_SECRET_ACCESS_KEY — set in .env file
//   AWS_REGION            — set in .env file (default: us-east-1)

const rawClient = new DynamoDBClient({
  region: process.env["AWS_REGION"] ?? "us-east-1",
  credentials: fromEnv(),
});

export const dynamoDb = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true,   // Don't store undefined as DynamoDB NULL
    convertClassInstanceToMap: true,
  },
});

// ── Table Names (from env vars set by SAM) ────────────────────────────────────

export const Tables = {
  LAUNCH_TOKENS: process.env["LAUNCH_TOKENS_TABLE"] ?? "sso-launch-tokens-dev",
  SESSIONS: process.env["SESSIONS_TABLE"] ?? "sso-sessions-dev",
  HMS_CLIENTS: process.env["HMS_CLIENTS_TABLE"] ?? "sso-hms-clients-dev",
} as const;

// ── Generic CRUD Wrappers ─────────────────────────────────────────────────────

/** Get a single item by primary key */
export async function getItem<T>(
  tableName: string,
  key: Record<string, string | number>
): Promise<T | null> {
  try{
    const params: GetCommandInput = { TableName: tableName, Key: key };
    const result = await dynamoDb.send(new GetCommand(params));
    console.log("result 1234567", result);
    return (result.Item as T) ?? null;
  } catch (error) {
    console.log("error 1234567", error);
    return null;
  }
  
}

/** Put (create or replace) an item */
export async function putItem<T>(
  tableName: string,
  item: T
): Promise<void> {
  try{
    const params: PutCommandInput = { TableName: tableName, Item: item as Record<string, unknown> };
    await dynamoDb.send(new PutCommand(params));
  }catch (error) {
    console.log("error ER RROR", error);
    throw error;
  }
}

/** Conditional put — fails if item already exists */
export async function putItemIfNotExists<T>(
  tableName: string,
  item: T,
  conditionKey: string
): Promise<void> {
  const params: PutCommandInput = {
    TableName: tableName,
    Item: item as Record<string, unknown>,
    ConditionExpression: `attribute_not_exists(#key)`,
    ExpressionAttributeNames: { "#key": conditionKey },
  };
  await dynamoDb.send(new PutCommand(params));
}

/** Update specific attributes on an item */
export async function updateItem(
  tableName: string,
  key: Record<string, string | number>,
  updates: Record<string, unknown>
): Promise<void> {
  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  Object.entries(updates).forEach(([field, value], idx) => {
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    updateExpressions.push(`${nameKey} = ${valueKey}`);
    expressionAttributeNames[nameKey] = field;
    expressionAttributeValues[valueKey] = value;
  });

  const params: UpdateCommandInput = {
    TableName: tableName,
    Key: key,
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  };
  await dynamoDb.send(new UpdateCommand(params));
}

/** Delete an item by primary key */
export async function deleteItem(
  tableName: string,
  key: Record<string, string | number>
): Promise<void> {
  const params: DeleteCommandInput = { TableName: tableName, Key: key };
  await dynamoDb.send(new DeleteCommand(params));
}

/** Query a GSI */
export async function queryByIndex<T>(
  tableName: string,
  indexName: string,
  keyCondition: string,
  expressionValues: Record<string, unknown>,
  expressionNames?: Record<string, string>
): Promise<T[]> {
  const params: QueryCommandInput = {
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: expressionValues,
    ...(expressionNames && { ExpressionAttributeNames: expressionNames }),
  };
  const result = await dynamoDb.send(new QueryCommand(params));
  return (result.Items as T[]) ?? [];
}
