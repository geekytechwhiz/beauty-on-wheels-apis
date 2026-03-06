import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Typed send for DynamoDB Document Client to work around @smithy/types version mismatch
 * between the client and command classes. Use instead of client.send(command).
 */
export async function sendDoc<T>(
  client: DynamoDBDocumentClient,
  command: unknown,
): Promise<T> {
  return (await (client as { send: (cmd: unknown) => Promise<unknown> }).send(command)) as T;
}
