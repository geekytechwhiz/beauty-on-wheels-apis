import {
  ICampaignRepository,
  CampaignRecord,
  CampaignBatchRecord,
} from '../../../common/providers/ICampaignRepository.js';
import { IRecipientRepository } from '../../../common/providers/IRecipientRepository.js';
import { ITemplateRegistryProvider } from '../../../common/providers/ITemplateRegistryProvider.js';
import { IStorageProvider } from '../../../common/providers/IStorageProvider.js';
import { IQueueProvider } from '../../../common/providers/IQueueProvider.js';
import { IOrchestratorProvider } from '../../../common/providers/IOrchestratorProvider.js';
import { environment } from '../../../common/config/environment.js';
import { InitiateCampaignInput } from '../dto/schemas.js';
import { logger } from '../../../common/utils/logger.js';
import crypto from 'crypto';

export class CampaignService {
  constructor(
    private campaignRepo: ICampaignRepository,
    private recipientRepo: IRecipientRepository,
    private templateRegistry: ITemplateRegistryProvider,
    private storage: IStorageProvider,
    private queue: IQueueProvider,
    private orchestrator: IOrchestratorProvider,
  ) {}

  // 1. HTTP Handler logic: Initiate Campaign
  async initiateCampaign(input: InitiateCampaignInput): Promise<{
    campaignId: string;
    executionArn: string;
    startDate: string;
    attachmentsUploaded: number;
    hasEmbeddedImages: boolean;
  }> {
    const groupId = input.groupId || input.recipientListFile;
    if (!groupId) {
      throw new Error('Missing recipient list group ID');
    }

    const timestamp = this.getFormattedTimestamp();
    const campaignId = `${input.campaignName}-${timestamp}`;
    const dateStr = new Date().toISOString();

    logger.info(`Initiating campaign: ${campaignId}`);

    // Check template for embedded images
    let templateS3Key: string | undefined;
    let hasEmbeddedImages = false;
    try {
      const template = await this.templateRegistry.getTemplate(input.templateName);
      const htmlContent = template.htmlContent || '';

      const dataUrlPattern = /<img[^>]+src="data:([^;]+);base64,([^"]+)"[^>]*>/;
      if (htmlContent && dataUrlPattern.test(htmlContent)) {
        hasEmbeddedImages = true;
        templateS3Key = `templates/${campaignId}/template.json`;

        logger.info(
          `Template ${input.templateName} has embedded images. Storing copy in S3: ${templateS3Key}`,
        );

        await this.storage.putObject({
          bucket: environment.attachmentsBucket,
          key: templateS3Key,
          body: JSON.stringify({
            templateName: input.templateName,
            subject: template.subject,
            htmlContent,
            textContent: template.textContent || '',
          }),
          contentType: 'application/json',
        });
      }
    } catch (err) {
      logger.warn(
        `Could not check template ${input.templateName} for inline images. Proceeding as standard.`,
        { err },
      );
    }

    // Process attachments
    const attachmentKeys: Array<{ filename: string; s3Key: string; contentType: string }> = [];
    if (input.attachments && input.attachments.length > 0) {
      for (const att of input.attachments) {
        const fileBuffer = Buffer.from(att.content, 'base64');
        const s3Key = `campaigns/${campaignId}/attachments/${att.filename}`;

        logger.info(`Uploading campaign attachment: ${att.filename} -> ${s3Key}`);

        await this.storage.putObject({
          bucket: environment.attachmentsBucket,
          key: s3Key,
          body: fileBuffer,
          contentType: att.contentType,
          metadata: {
            'original-filename': att.filename,
            'content-type': att.contentType,
          },
        });

        attachmentKeys.push({
          filename: att.filename,
          s3Key,
          contentType: att.contentType,
        });
      }
    }

    // Trigger Step Function state machine
    const stateMachineArn = process.env.STEP_FUNCTION_ARN || '';
    if (!stateMachineArn) {
      throw new Error('STEP_FUNCTION_ARN environment variable not configured');
    }

    const stepInput = {
      campaignName: input.campaignName,
      templateName: input.templateName,
      groupId,
      recipientListFile: groupId,
      campaignId,
      initiatedAt: dateStr,
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      attachments: attachmentKeys,
      topicName: input.topicName || '',
      ...(templateS3Key ? { templateS3Key } : {}),
    };

    logger.info(`Triggering campaign processor state machine: ${stateMachineArn}`);
    const execution = await this.orchestrator.startExecution({
      stateMachineArn,
      name: `Campaign-${campaignId}`,
      input: stepInput,
    });

    return {
      campaignId,
      executionArn: execution.executionArn,
      startDate: execution.startDate.toISOString(),
      attachmentsUploaded: attachmentKeys.length,
      hasEmbeddedImages,
    };
  }

  // 2. Step Functions Task: Setup Campaign Resources
  async setupCampaign(event: any): Promise<any> {
    logger.info('Setting up campaign records in DynamoDB', { event });

    const campaignId = event.campaignId || `campaign-${Date.now()}`;
    const dateStr = new Date().toISOString();

    const campaign: CampaignRecord = {
      campaignId,
      campaignName: event.campaignName || 'default-campaign',
      templateName: event.templateName,
      status: 'PROCESSING',
      createdAt: dateStr,
      updatedAt: dateStr,
      senderEmail: event.senderEmail,
      senderName: event.senderName,
      topicName: event.topicName,
      attachmentsCount: event.attachments?.length || 0,
      hasEmbeddedImages: !!event.templateS3Key,
    };

    await this.campaignRepo.createCampaign(campaign);

    // Return parameters matching what subsequent Step Function tasks expect,
    // pointing them to the static, permanent tables.
    return {
      campaignId,
      recipientTrackingTable: environment.recipientTrackingTable,
      batchTrackingTable: environment.campaignBatchesTable,
      senderEmail: event.senderEmail,
      senderName: event.senderName,
      attachments: event.attachments || [],
      topicName: event.topicName || '',
      templateS3Key: event.templateS3Key,
    };
  }

  // 3. Step Functions Task: Extract Data and Create Batches
  async extractData(event: any): Promise<any> {
    logger.info('Starting recipient extraction', { event });

    const groupId = event.recipientListFile || event.groupId;
    const campaignId = event.campaignId;
    const batchSize = environment.batchSize;

    if (!groupId || !campaignId) {
      throw new Error('Missing required campaign parameters: campaignId or groupId');
    }

    // Retrieve recipients
    const allRecipients = await this.recipientRepo.listRecipientsInGroup(groupId);
    const totalCount = allRecipients.length;

    logger.info(`Retrieved ${totalCount} recipients for group: ${groupId}`);

    if (totalCount === 0) {
      return {
        statusCode: 200,
        message: 'No recipients found for this campaign list',
        campaignId,
        batches: [],
      };
    }

    const totalBatches = Math.ceil(totalCount / batchSize);
    const manifestBatches: Array<{
      batchId: string;
      objectKey: string;
      recipientCount: number;
      recipientTrackingTable: string;
      batchTrackingTable: string;
    }> = [];

    const dateStr = new Date().toISOString();
    const expirationTime = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days TTL

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const startIdx = batchNum * batchSize;
      const endIdx = Math.min(startIdx + batchSize, totalCount);
      const batchRecipients = allRecipients.slice(startIdx, endIdx);

      const batchId = `${campaignId}-batch-${String(batchNum + 1).padStart(4, '0')}`;
      const batchKey = `batches/${campaignId}/${batchId}.json`;

      const batchData = {
        batchId,
        campaignId,
        recipientTrackingTable: environment.recipientTrackingTable,
        batchTrackingTable: environment.campaignBatchesTable,
        sender: {
          email: event.senderEmail,
          name: event.senderName,
        },
        template: {
          name: event.templateName,
          version: '1.0',
        },
        destinations: batchRecipients.map(r => ({
          email: r.emailAddress,
          metadata: {
            firstName: r.firstName || '',
            lastName: r.lastName || '',
            emailId: crypto.randomUUID(),
          },
        })),
        attachments: event.attachments || [],
        topicName: event.topicName || '',
        templateS3Key: event.templateS3Key,
        createdAt: dateStr,
        campaignName: event.campaignName,
      };

      // Upload JSON batch file to S3
      await this.storage.putObject({
        bucket: environment.emailBatchBucket,
        key: batchKey,
        body: JSON.stringify(batchData),
        contentType: 'application/json',
      });

      // Track batch in DynamoDB
      const batchRecord: CampaignBatchRecord = {
        campaignId,
        batchId,
        status: 'PENDING',
        recipientCount: batchRecipients.length,
        s3Key: batchKey,
        createdAt: dateStr,
        expirationTime,
      };
      await this.campaignRepo.createBatch(batchRecord);

      manifestBatches.push({
        batchId,
        objectKey: batchKey,
        recipientCount: batchRecipients.length,
        recipientTrackingTable: environment.recipientTrackingTable,
        batchTrackingTable: environment.campaignBatchesTable,
      });
    }

    // Write campaign manifest to S3
    const manifestKey = `batches/${campaignId}/manifest.json`;
    const manifest = {
      campaignId,
      totalRecipients: totalCount,
      createdAt: dateStr,
      sender: {
        email: event.senderEmail,
        name: event.senderName,
      },
      template: {
        name: event.templateName,
        version: '1.0',
      },
      batches: manifestBatches,
      isComplete: true,
    };

    await this.storage.putObject({
      bucket: environment.emailBatchBucket,
      key: manifestKey,
      body: JSON.stringify(manifest),
      contentType: 'application/json',
    });

    // Update campaign record total count
    const campaign = await this.campaignRepo.getCampaign(campaignId);
    if (campaign) {
      campaign.totalRecipients = totalCount;
      campaign.updatedAt = dateStr;
      await this.campaignRepo.createCampaign(campaign);
    }

    return {
      statusCode: 200,
      message: 'Recipient batches generated successfully',
      campaignId,
      manifestKey,
      processedRecipients: totalCount,
      batchesCreated: totalBatches,
      recipientTrackingTable: environment.recipientTrackingTable,
      batchTrackingTable: environment.campaignBatchesTable,
      batches: manifestBatches,
      senderEmail: event.senderEmail,
      senderName: event.senderName,
    };
  }

  // 4. Step Functions Task: Process Batch (Enqueue SQS Messages)
  async processBatch(event: any): Promise<any> {
    logger.info('Processing batch execution', { event });

    const batchId = event.batchId;
    const s3Key = event.objectKey;
    const campaignId = event.campaignId;

    if (!batchId || !s3Key || !campaignId) {
      throw new Error('Missing batch parameters in task execution');
    }

    // Check if batch is already queued or processed
    const batchInfo = await this.campaignRepo.getBatch(campaignId, batchId);
    if (
      batchInfo &&
      ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'QUEUED_FOR_SENDING'].includes(batchInfo.status)
    ) {
      logger.info(`Batch ${batchId} already processed with status ${batchInfo.status}. Skipping.`);
      return {
        statusCode: 200,
        batchId,
        status: batchInfo.status,
      };
    }

    // Load batch details from S3
    const s3Object = await this.storage.getObject(environment.emailBatchBucket, s3Key);
    const batchData = JSON.parse(s3Object.body);

    // Update status to IN_PROCESSING
    const dateStr = new Date().toISOString();
    await this.campaignRepo.updateBatchStatus({
      campaignId,
      batchId,
      status: 'IN_PROCESSING',
      processingStartTime: dateStr,
    });

    const destinations = batchData.destinations || [];
    if (destinations.length === 0) {
      logger.warn(`Batch ${batchId} has no recipients`);
      await this.campaignRepo.updateBatchStatus({
        campaignId,
        batchId,
        status: 'COMPLETED',
        processingEndTime: dateStr,
      });
      return {
        batchId,
        status: 'COMPLETED',
      };
    }

    // Queue messages to SQS (10 messages per SQS batch write)
    const sqsQueueUrl = environment.emailQueueUrl;
    let messagesQueued = 0;
    const CHUNK_SIZE = 10;

    for (let i = 0; i < destinations.length; i += CHUNK_SIZE) {
      const chunk = destinations.slice(i, i + CHUNK_SIZE);
      const entries = chunk.map((recipient: any) => {
        const messageId = crypto.randomUUID();
        const sqsBody = {
          batchId,
          campaignId,
          recipientTrackingTable: environment.recipientTrackingTable,
          batchTrackingTable: environment.campaignBatchesTable,
          recipient,
          sender: batchData.sender,
          template: batchData.template,
          attachments: batchData.attachments,
          topicName: batchData.topicName,
          templateS3Key: batchData.templateS3Key,
          timestamp: dateStr,
          attempts: 0,
          messageId,
        };

        return {
          id: messageId,
          body: JSON.stringify(sqsBody),
        };
      });

      const response = await this.queue.sendMessageBatch(sqsQueueUrl, entries);
      messagesQueued += response.successful.length;

      if (response.failed.length > 0) {
        logger.error(`Some messages failed to queue in SQS for batch ${batchId}`, {
          failed: response.failed,
        });
      }
    }

    // Update status in database
    await this.campaignRepo.updateBatchStatus({
      campaignId,
      batchId,
      status: 'QUEUED_FOR_SENDING',
      queuedTime: new Date().toISOString(),
      queuedCount: messagesQueued,
    });

    // Start Batch Monitor state machine
    const monitoringStateMachineArn = process.env.MONITORING_STATE_MACHINE_ARN || '';
    if (monitoringStateMachineArn) {
      try {
        const monitorExecId = `Monitor-${batchId}-${Date.now()}`;
        await this.orchestrator.startExecution({
          stateMachineArn: monitoringStateMachineArn,
          name: monitorExecId,
          input: {
            batchId,
            campaignId,
            recipientTrackingTable: environment.recipientTrackingTable,
            batchTrackingTable: environment.campaignBatchesTable,
            startTime: new Date().toISOString(),
            totalMessages: messagesQueued,
            maxWaitMinutes: 600,
          },
        });
        logger.info(`Triggered monitoring execution: ${monitorExecId}`);
      } catch (err) {
        logger.error(`Failed to start monitoring state machine for batch ${batchId}`, { err });
      }
    }

    return {
      statusCode: 200,
      batchId,
      messagesQueued,
      status: 'QUEUED_FOR_SENDING',
    };
  }

  // --- Helper Utils ---
  private getFormattedTimestamp(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hour}${min}${sec}`;
  }
}
