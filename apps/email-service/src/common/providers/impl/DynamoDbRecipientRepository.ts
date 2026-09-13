import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  IRecipientRepository,
  RecipientGroupRecord,
  RecipientRecord,
} from '../IRecipientRepository.js';
import { logger } from '../../utils/logger.js';

import { environment } from '../../config/environment.js';

export class DynamoDbRecipientRepository implements IRecipientRepository {
  private docClient: DynamoDBDocumentClient;
  private registryTable: string;
  private recipientsTable: string;

  constructor(region: string, registryTable: string, recipientsTable: string) {
    const config: any = { region };
    if (environment.isOffline) {
      config.endpoint = environment.dynamodbEndpoint;
      config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
    }
    const client = new DynamoDBClient(config);
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.registryTable = registryTable;
    this.recipientsTable = recipientsTable;
  }

  // --- Recipient Group Registry ---
  async registerGroup(group: RecipientGroupRecord): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.registryTable,
        Item: {
          TableName: group.groupId, // Preserve compatibility: 'TableName' is the PK of registry table
          OriginalFilename: group.originalFilename,
          CreatedAt: group.createdAt,
          S3Key: group.s3Key,
          RecipientListTable: group.groupId, // Same for compatibility
          Source: group.source,
        },
      });
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error registering recipient group in registry table', {
        error,
        groupId: group.groupId,
      });
      throw error;
    }
  }

  async getGroup(groupId: string): Promise<RecipientGroupRecord | null> {
    try {
      const command = new GetCommand({
        TableName: this.registryTable,
        Key: { TableName: groupId }, // PK in registry table is TableName
      });
      const response = await this.docClient.send(command);
      if (!response.Item) return null;

      return {
        groupId: response.Item.TableName,
        originalFilename: response.Item.OriginalFilename || '',
        createdAt: response.Item.CreatedAt || '',
        s3Key: response.Item.S3Key || '',
        source: response.Item.Source || 'csv',
      };
    } catch (error) {
      logger.error('Error fetching group registry from DynamoDB', { error, groupId });
      throw error;
    }
  }

  async listGroups(): Promise<RecipientGroupRecord[]> {
    try {
      const command = new ScanCommand({
        TableName: this.registryTable,
      });
      const response = await this.docClient.send(command);
      return (response.Items || []).map(item => ({
        groupId: item.TableName,
        originalFilename: item.OriginalFilename || '',
        createdAt: item.CreatedAt || '',
        s3Key: item.S3Key || '',
        source: item.Source || 'csv',
      }));
    } catch (error) {
      logger.error('Error scanning group registry from DynamoDB', { error });
      throw error;
    }
  }

  // --- Recipient List CRUD ---
  async addRecipient(recipient: RecipientRecord): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.recipientsTable,
        Item: {
          GroupId: recipient.groupId,
          EmailAddress: recipient.emailAddress,
          FirstName: recipient.firstName,
          LastName: recipient.lastName,
          Topics: recipient.topics || [],
          CreatedAt: recipient.createdAt,
        },
      });
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error inserting recipient in DynamoDB', {
        error,
        groupId: recipient.groupId,
        email: recipient.emailAddress,
      });
      throw error;
    }
  }

  async addRecipientsBatch(recipients: RecipientRecord[]): Promise<void> {
    if (recipients.length === 0) return;

    const CHUNK_SIZE = 25;
    try {
      for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
        const chunk = recipients.slice(i, i + CHUNK_SIZE);
        const writeRequests = chunk.map(r => ({
          PutRequest: {
            Item: {
              GroupId: r.groupId,
              EmailAddress: r.emailAddress,
              FirstName: r.firstName,
              LastName: r.lastName,
              Topics: r.topics || [],
              CreatedAt: r.createdAt,
            },
          },
        }));

        const command = new BatchWriteCommand({
          RequestItems: {
            [this.recipientsTable]: writeRequests,
          },
        });

        const result = await this.docClient.send(command);
        let unprocessed = result.UnprocessedItems;

        // Exponential backoff retry for unprocessed items if any
        let retries = 0;
        while (
          unprocessed &&
          unprocessed[this.recipientsTable] &&
          unprocessed[this.recipientsTable]!.length > 0 &&
          retries < 3
        ) {
          retries++;
          const waitTime = Math.pow(2, retries) * 100;
          await new Promise(r => setTimeout(r, waitTime));

          const retryCommand = new BatchWriteCommand({
            RequestItems: unprocessed,
          });
          const retryResult = await this.docClient.send(retryCommand);
          unprocessed = retryResult.UnprocessedItems;
        }

        if (
          unprocessed &&
          unprocessed[this.recipientsTable] &&
          unprocessed[this.recipientsTable]!.length > 0
        ) {
          throw new Error(
            `Failed to insert batch of recipients: ${unprocessed[this.recipientsTable]!.length} items left unprocessed after retries.`,
          );
        }
      }
    } catch (error) {
      logger.error('Error batch-inserting recipients in DynamoDB', {
        error,
        count: recipients.length,
      });
      throw error;
    }
  }

  async listRecipientsInGroup(groupId: string): Promise<RecipientRecord[]> {
    try {
      const recipients: RecipientRecord[] = [];
      let lastEvaluatedKey: Record<string, any> | undefined;

      do {
        const command: QueryCommand = new QueryCommand({
          TableName: this.recipientsTable,
          KeyConditionExpression: 'GroupId = :groupId',
          ExpressionAttributeValues: {
            ':groupId': groupId,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const response = await this.docClient.send(command);
        for (const item of response.Items || []) {
          recipients.push({
            groupId: item.GroupId,
            emailAddress: item.EmailAddress,
            firstName: item.FirstName,
            lastName: item.LastName,
            topics: item.Topics,
            createdAt: item.CreatedAt,
          });
        }

        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return recipients;
    } catch (error) {
      logger.error('Error querying recipients in group from DynamoDB', { error, groupId });
      throw error;
    }
  }
}
