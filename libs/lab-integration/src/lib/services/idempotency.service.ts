import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * Idempotency service for preventing duplicate operations.
 * Stores idempotency keys with their results in DynamoDB with 24-hour TTL.
 */
export class IdempotencyService {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly ttlSeconds = 86400; // 24 hours

  constructor(
    tableName: string =
      process.env.IDEMPOTENCY_TABLE_NAME ?? 'lab-integration-idempotency'
  ) {
    const dynamoClient = new DynamoDBClient({});
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = tableName;
  }

  /**
   * Check if an idempotency key exists and return cached result if found.
   * @param key - Idempotency key from client
   * @returns Cached result or null if key not found
   */
  async getResult<T>(key: string): Promise<T | null> {
    try {
      const response = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { idempotencyKey: key },
        })
      );

      if (response.Item) {
        return response.Item.result as T;
      }
      return null;
    } catch (error) {
      console.error('Error checking idempotency key:', error);
      return null; // Proceed with operation on error
    }
  }

  /**
   * Store result with idempotency key.
   * @param key - Idempotency key from client
   * @param result - Operation result to cache
   */
  async storeResult<T>(key: string, result: T): Promise<void> {
    try {
      const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            idempotencyKey: key,
            result,
            ttl,
            createdAt: new Date().toISOString(),
          },
        })
      );
    } catch (error) {
      console.error('Error storing idempotency result:', error);
      // Don't throw - operation already succeeded
    }
  }
}
