import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { IQueueProvider, QueueMessageBatchEntry } from '../IQueueProvider.js';
import { logger } from '../../utils/logger.js';

import { environment } from '../../config/environment.js';

export class SqsQueueProvider implements IQueueProvider {
  private client: SQSClient;

  constructor(region: string) {
    const config: any = { region };
    if (environment.isOffline) {
      config.endpoint = environment.sqsEndpoint;
      config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
    }
    this.client = new SQSClient(config);
  }

  async sendMessageBatch(
    queueUrl: string,
    entries: QueueMessageBatchEntry[],
  ): Promise<{
    successful: string[];
    failed: { id: string; message: string }[];
  }> {
    if (entries.length === 0) {
      return { successful: [], failed: [] };
    }

    try {
      const command = new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: entries.map(e => ({
          Id: e.id,
          MessageBody: e.body,
        })),
      });

      const response = await this.client.send(command);

      const successful = (response.Successful || []).map(s => s.Id || '');
      const failed = (response.Failed || []).map(f => ({
        id: f.Id || '',
        message: f.Message || 'Unknown SQS batch error',
      }));

      return { successful, failed };
    } catch (error) {
      logger.error('Error sending message batch to SQS', {
        error,
        queueUrl,
        entriesCount: entries.length,
      });
      throw error;
    }
  }
}
