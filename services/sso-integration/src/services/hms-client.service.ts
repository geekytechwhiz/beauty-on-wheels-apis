/**
 * HMS Client Registry Service
 * Manages HMS client credentials and launch configuration
 * Uses in-memory storage for local dev (serverless offline) when AWS credentials unavailable
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';
import { HMSClient } from '../types';

import { getConfig } from '../config';

const getTableName = (): string => {
  try {
    return getConfig().hmsClientsTable;
  } catch {
    // Fallback if config not loaded yet
    return process.env.HMS_CLIENTS_TABLE || '';
  }
};

const getUseInMemory = (): boolean => {
  try {
    return getConfig().useInMemoryStorage;
  } catch {
    // Fallback if config not loaded yet
    return process.env.IS_OFFLINE === 'true' || process.env.USE_IN_MEMORY_STORAGE === 'true';
  }
};

// In-memory store for local development (no AWS credentials needed)
const memoryStore = new Map<string, HMSClient>();

let docClient: DynamoDBDocumentClient | null = null;

function initDynamoClient(): void {
  const useInMemory = getUseInMemory();
  const tableName = getTableName();
  
  if (!useInMemory && tableName) {
    try {
      const client = new DynamoDBClient({});
      docClient = DynamoDBDocumentClient.from(client);
    } catch {
      logger.warn('DynamoDB client init failed, using in-memory storage');
      docClient = null;
    }
  }
}

// Initialize on module load
initDynamoClient();

export class HMSClientService {
  private useDynamo(): boolean {
    const useInMemory = getUseInMemory();
    const tableName = getTableName();
    return !useInMemory && !!docClient && !!tableName;
  }

  private getTableName(): string {
    return getTableName();
  }

  async getClient(clientId: string): Promise<HMSClient | null> {
    if (this.useDynamo()) {
      try {
        const result = await docClient!.send(
          new GetCommand({
            TableName: this.getTableName(),
            Key: { clientId },
          })
        );
        return (result.Item as HMSClient) || null;
      } catch (error) {
        logger.warn('DynamoDB get failed, falling back to in-memory', { error: (error as Error).message });
        return memoryStore.get(clientId) || null;
      }
    }

    return memoryStore.get(clientId) || null;
  }

  async getClientByHmsId(hmsId: string): Promise<HMSClient | null> {
    if (this.useDynamo()) {
      try {
        // Query the GSI hmsId-index to find client by hmsId
        const result = await docClient!.send(
          new QueryCommand({
            TableName: this.getTableName(),
            IndexName: 'hmsId-index',
            KeyConditionExpression: 'hmsId = :hmsId',
            ExpressionAttributeValues: {
              ':hmsId': hmsId,
            },
            Limit: 1, // hmsId should be unique, but limit to first match
          })
        );
        return (result.Items && result.Items.length > 0 ? (result.Items[0] as HMSClient) : null) || null;
      } catch (error) {
        logger.warn('DynamoDB query by hmsId failed, falling back to in-memory', { error: (error as Error).message });
        for (const client of memoryStore.values()) {
          if (client.hmsId === hmsId) return client;
        }
        return null;
      }
    }

    for (const client of memoryStore.values()) {
      if (client.hmsId === hmsId) return client;
    }
    return null;
  }

  async validateClient(clientId: string, clientSecret?: string): Promise<HMSClient | null> {
    const hmsClient = await this.getClient(clientId);
    if (!hmsClient) return null;
    if (!hmsClient.active) return null;
    if (clientSecret && hmsClient.clientSecret !== clientSecret) return null;
    return hmsClient;
  }

  async registerClient(hmsClient: Omit<HMSClient, 'createdAt' | 'active'>): Promise<HMSClient> {
    const fullClient: HMSClient = {
      ...hmsClient,
      createdAt: new Date().toISOString(),
      active: true,
    };

    if (this.useDynamo()) {
      try {
        await docClient!.send(
          new PutCommand({
            TableName: this.getTableName(),
            Item: fullClient,
          })
        );
      } catch (error) {
        logger.warn('DynamoDB put failed, using in-memory', { error: (error as Error).message });
        memoryStore.set(fullClient.clientId, fullClient);
      }
    } else {
      memoryStore.set(fullClient.clientId, fullClient);
    }

    logger.info('HMS client registered', { hmsId: hmsClient.hmsId, clientId: hmsClient.clientId });
    return fullClient;
  }
}
