import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ICampaignRepository,
  CampaignRecord,
  CampaignBatchRecord,
  RecipientTrackingRecord,
} from '../ICampaignRepository.js';
import { logger } from '../../utils/logger.js';

import { environment } from '../../config/environment.js';

export class DynamoDbCampaignRepository implements ICampaignRepository {
  private docClient: DynamoDBDocumentClient;
  private campaignsTable: string;
  private batchesTable: string;
  private recipientTrackingTable: string;

  constructor(
    region: string,
    campaignsTable: string,
    batchesTable: string,
    recipientTrackingTable: string,
  ) {
    const config: any = { region };
    if (environment.isOffline) {
      config.endpoint = environment.dynamodbEndpoint;
      config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
    }
    const client = new DynamoDBClient(config);
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.campaignsTable = campaignsTable;
    this.batchesTable = batchesTable;
    this.recipientTrackingTable = recipientTrackingTable;
  }

  // --- Campaign Metadata ---
  async createCampaign(campaign: CampaignRecord): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.campaignsTable,
        Item: {
          CampaignId: campaign.campaignId,
          CampaignName: campaign.campaignName,
          TemplateName: campaign.templateName,
          Status: campaign.status,
          CreatedAt: campaign.createdAt,
          UpdatedAt: campaign.updatedAt,
          TotalRecipients: campaign.totalRecipients,
          SenderEmail: campaign.senderEmail,
          SenderName: campaign.senderName,
          TopicName: campaign.topicName,
          AttachmentsCount: campaign.attachmentsCount,
          HasEmbeddedImages: campaign.hasEmbeddedImages,
        },
      });
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error creating campaign in DynamoDB', {
        error,
        campaignId: campaign.campaignId,
      });
      throw error;
    }
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord | null> {
    try {
      const command = new GetCommand({
        TableName: this.campaignsTable,
        Key: { CampaignId: campaignId },
      });
      const response = await this.docClient.send(command);
      if (!response.Item) return null;

      return {
        campaignId: response.Item.CampaignId,
        campaignName: response.Item.CampaignName,
        templateName: response.Item.TemplateName,
        status: response.Item.Status,
        createdAt: response.Item.CreatedAt,
        updatedAt: response.Item.UpdatedAt,
        totalRecipients: response.Item.TotalRecipients,
        senderEmail: response.Item.SenderEmail,
        senderName: response.Item.SenderName,
        topicName: response.Item.TopicName,
        attachmentsCount: response.Item.AttachmentsCount,
        hasEmbeddedImages: response.Item.HasEmbeddedImages,
      };
    } catch (error) {
      logger.error('Error fetching campaign from DynamoDB', { error, campaignId });
      throw error;
    }
  }

  async updateCampaignStatus(campaignId: string, status: string): Promise<void> {
    try {
      const command = new UpdateCommand({
        TableName: this.campaignsTable,
        Key: { CampaignId: campaignId },
        UpdateExpression: 'SET #status = :status, UpdatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'Status',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': new Date().toISOString(),
        },
      });
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error updating campaign status in DynamoDB', { error, campaignId, status });
      throw error;
    }
  }

  // --- Batch Tracking ---
  async createBatch(batch: CampaignBatchRecord): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.batchesTable,
        Item: {
          CampaignId: batch.campaignId,
          BatchId: batch.batchId,
          Status: batch.status,
          RecipientCount: batch.recipientCount,
          QueuedCount: batch.queuedCount || 0,
          SentCount: batch.sentCount || 0,
          FailedCount: batch.failedCount || 0,
          S3Key: batch.s3Key,
          CreatedAt: batch.createdAt,
          ExpirationTime: batch.expirationTime,
        },
      });
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error creating batch in DynamoDB', {
        error,
        campaignId: batch.campaignId,
        batchId: batch.batchId,
      });
      throw error;
    }
  }

  async getBatch(campaignId: string, batchId: string): Promise<CampaignBatchRecord | null> {
    try {
      const command = new GetCommand({
        TableName: this.batchesTable,
        Key: {
          CampaignId: campaignId,
          BatchId: batchId,
        },
      });
      const response = await this.docClient.send(command);
      if (!response.Item) return null;

      return {
        campaignId: response.Item.CampaignId,
        batchId: response.Item.BatchId,
        status: response.Item.Status,
        recipientCount: response.Item.RecipientCount,
        queuedCount: response.Item.QueuedCount,
        sentCount: response.Item.SentCount,
        failedCount: response.Item.FailedCount,
        s3Key: response.Item.S3Key,
        createdAt: response.Item.CreatedAt,
        processingStartTime: response.Item.ProcessingStartTime,
        processingEndTime: response.Item.ProcessingEndTime,
        queuedTime: response.Item.QueuedTime,
        errorMessage: response.Item.ErrorMessage,
        expirationTime: response.Item.ExpirationTime,
      };
    } catch (error) {
      logger.error('Error fetching batch from DynamoDB', { error, campaignId, batchId });
      throw error;
    }
  }

  async updateBatchStatus(options: {
    campaignId: string;
    batchId: string;
    status: CampaignBatchRecord['status'];
    processingStartTime?: string;
    processingEndTime?: string;
    queuedTime?: string;
    queuedCount?: number;
    errorMessage?: string;
  }): Promise<void> {
    try {
      const expressions: string[] = ['#status = :status'];
      const names: Record<string, string> = { '#status': 'Status' };
      const values: Record<string, any> = { ':status': options.status };

      if (options.processingStartTime) {
        expressions.push('ProcessingStartTime = :startTime');
        values[':startTime'] = options.processingStartTime;
      }
      if (options.processingEndTime) {
        expressions.push('ProcessingEndTime = :endTime');
        values[':endTime'] = options.processingEndTime;
      }
      if (options.queuedTime) {
        expressions.push('QueuedTime = :queuedTime');
        values[':queuedTime'] = options.queuedTime;
      }
      if (options.queuedCount !== undefined) {
        expressions.push('QueuedCount = :queuedCount');
        values[':queuedCount'] = options.queuedCount;
      }
      if (options.errorMessage !== undefined) {
        expressions.push('ErrorMessage = :errorMessage');
        values[':errorMessage'] = options.errorMessage;
      }

      const command = new UpdateCommand({
        TableName: this.batchesTable,
        Key: {
          CampaignId: options.campaignId,
          BatchId: options.batchId,
        },
        UpdateExpression: `SET ${expressions.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      });

      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error updating batch status in DynamoDB', { error, options });
      throw error;
    }
  }

  async incrementBatchCounts(options: {
    campaignId: string;
    batchId: string;
    sentIncrement: number;
    failedIncrement: number;
  }): Promise<void> {
    try {
      const command = new UpdateCommand({
        TableName: this.batchesTable,
        Key: {
          CampaignId: options.campaignId,
          BatchId: options.batchId,
        },
        UpdateExpression: 'ADD SentCount :sent, FailedCount :failed',
        ExpressionAttributeValues: {
          ':sent': options.sentIncrement,
          ':failed': options.failedIncrement,
        },
      });
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error incrementing batch counts in DynamoDB', { error, options });
      throw error;
    }
  }

  async listBatchesForCampaign(campaignId: string): Promise<CampaignBatchRecord[]> {
    try {
      const command = new QueryCommand({
        TableName: this.batchesTable,
        KeyConditionExpression: 'CampaignId = :campaignId',
        ExpressionAttributeValues: {
          ':campaignId': campaignId,
        },
      });

      const response = await this.docClient.send(command);
      return (response.Items || []).map(item => ({
        campaignId: item.CampaignId,
        batchId: item.BatchId,
        status: item.Status,
        recipientCount: item.RecipientCount,
        queuedCount: item.QueuedCount,
        sentCount: item.SentCount,
        failedCount: item.FailedCount,
        s3Key: item.S3Key,
        createdAt: item.CreatedAt,
        processingStartTime: item.ProcessingStartTime,
        processingEndTime: item.ProcessingEndTime,
        queuedTime: item.QueuedTime,
        errorMessage: item.ErrorMessage,
        expirationTime: item.ExpirationTime,
      }));
    } catch (error) {
      logger.error('Error listing campaign batches from DynamoDB', { error, campaignId });
      throw error;
    }
  }

  // --- Recipient Tracking ---
  async createOrUpdateRecipientTracking(record: RecipientTrackingRecord): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.recipientTrackingTable,
        Item: {
          CampaignId: record.campaignId,
          EmailAddress: record.emailAddress,
          BatchId: record.batchId,
          Status: record.status,
          SentTimestamp: record.sentTimestamp,
          ErrorMessage: record.errorMessage,
          Attempts: record.attempts,
          MessageId: record.messageId,
          ExpirationTime: record.expirationTime,
        },
      });
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error writing recipient tracking in DynamoDB', {
        error,
        campaignId: record.campaignId,
        email: record.emailAddress,
      });
      throw error;
    }
  }

  async getRecipientTracking(
    campaignId: string,
    emailAddress: string,
  ): Promise<RecipientTrackingRecord | null> {
    try {
      const command = new GetCommand({
        TableName: this.recipientTrackingTable,
        Key: {
          CampaignId: campaignId,
          EmailAddress: emailAddress,
        },
      });
      const response = await this.docClient.send(command);
      if (!response.Item) return null;

      return {
        campaignId: response.Item.CampaignId,
        emailAddress: response.Item.EmailAddress,
        batchId: response.Item.BatchId,
        status: response.Item.Status,
        sentTimestamp: response.Item.SentTimestamp,
        errorMessage: response.Item.ErrorMessage,
        attempts: response.Item.Attempts,
        messageId: response.Item.MessageId,
        expirationTime: response.Item.ExpirationTime,
      };
    } catch (error) {
      logger.error('Error fetching recipient tracking from DynamoDB', {
        error,
        campaignId,
        emailAddress,
      });
      throw error;
    }
  }
}
