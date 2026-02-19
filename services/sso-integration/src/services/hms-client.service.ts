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
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';
import { HMSClient } from '../types';

const TABLE_NAME = process.env.HMS_CLIENTS_TABLE || '';
const USE_IN_MEMORY = process.env.IS_OFFLINE === 'true' || process.env.USE_IN_MEMORY_STORAGE === 'true';

// In-memory store for local development (no AWS credentials needed)
const memoryStore = new Map<string, HMSClient>();

let docClient: DynamoDBDocumentClient | null = null;

if (!USE_IN_MEMORY && TABLE_NAME) {
  try {
    const client = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(client);
  } catch {
    logger.warn('DynamoDB client init failed, using in-memory storage');
    docClient = null;
  }
}

export class HMSClientService {
  private useDynamo(): boolean {
    return !USE_IN_MEMORY && !!docClient && !!TABLE_NAME;
  }

  async getClient(clientId: string): Promise<HMSClient | null> {
    if (this.useDynamo()) {
      try {
        const result = await docClient!.send(
          new GetCommand({
            TableName: TABLE_NAME,
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
        const result = await docClient!.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { clientId: hmsId },
          })
        );
        return (result.Item as HMSClient) || null;
      } catch {
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
            TableName: TABLE_NAME,
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
