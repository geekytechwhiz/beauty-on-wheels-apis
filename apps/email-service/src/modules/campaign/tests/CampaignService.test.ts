import { CampaignService } from '../services/CampaignService.js';
import { ICampaignRepository } from '../../../common/providers/ICampaignRepository.js';
import { IRecipientRepository } from '../../../common/providers/IRecipientRepository.js';
import { ITemplateRegistryProvider } from '../../../common/providers/ITemplateRegistryProvider.js';
import { IStorageProvider } from '../../../common/providers/IStorageProvider.js';
import { IQueueProvider } from '../../../common/providers/IQueueProvider.js';
import { IOrchestratorProvider } from '../../../common/providers/IOrchestratorProvider.js';
import { environment } from '../../../common/config/environment.js';

describe('CampaignService', () => {
  let campaignService: CampaignService;
  let mockCampaignRepo: jest.Mocked<ICampaignRepository>;
  let mockRecipientRepo: jest.Mocked<IRecipientRepository>;
  let mockTemplateRegistry: jest.Mocked<ITemplateRegistryProvider>;
  let mockStorage: jest.Mocked<IStorageProvider>;
  let mockQueue: jest.Mocked<IQueueProvider>;
  let mockOrchestrator: jest.Mocked<IOrchestratorProvider>;

  beforeEach(() => {
    mockCampaignRepo = {
      createCampaign: jest.fn(),
      getCampaign: jest.fn(),
      updateCampaignStatus: jest.fn(),
      createBatch: jest.fn(),
      getBatch: jest.fn(),
      updateBatchStatus: jest.fn(),
      incrementBatchCounts: jest.fn(),
      listBatchesForCampaign: jest.fn(),
      createOrUpdateRecipientTracking: jest.fn(),
      getRecipientTracking: jest.fn(),
    } as any;

    mockRecipientRepo = {
      registerGroup: jest.fn(),
      getGroup: jest.fn(),
      listGroups: jest.fn(),
      addRecipient: jest.fn(),
      addRecipientsBatch: jest.fn(),
      listRecipientsInGroup: jest.fn(),
    } as any;

    mockTemplateRegistry = {
      createTemplate: jest.fn(),
      getTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
      listTemplates: jest.fn(),
    } as any;

    mockStorage = {
      putObject: jest.fn(),
      getObject: jest.fn(),
      getObjectAsBuffer: jest.fn(),
      generatePresignedUploadUrl: jest.fn(),
    } as any;

    mockQueue = {
      sendMessageBatch: jest.fn(),
    } as any;

    mockOrchestrator = {
      startExecution: jest.fn(),
    } as any;

    campaignService = new CampaignService(
      mockCampaignRepo,
      mockRecipientRepo,
      mockTemplateRegistry,
      mockStorage,
      mockQueue,
      mockOrchestrator,
    );
  });

  describe('initiateCampaign', () => {
    it('should upload base64 attachments, detect inline images and start Step Functions', async () => {
      process.env.STEP_FUNCTION_ARN =
        'arn:aws:states:us-east-1:123456789012:stateMachine:EmailCampaign';
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'temp-1',
        subject: 'My Newsletter',
        htmlContent: '<html><body><img src="data:image/png;base64,iVBORw0KGgo=" /></body></html>',
      });
      mockStorage.putObject.mockResolvedValue(undefined);
      mockOrchestrator.startExecution.mockResolvedValue({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:EmailCampaign:Campaign-1',
        startDate: new Date(),
      });

      const input = {
        campaignName: 'test-campaign',
        templateName: 'temp-1',
        groupId: 'recipients-my-list',
        senderEmail: 'sender@example.com',
        senderName: 'Sender',
        attachments: [
          { filename: 'doc.pdf', content: 'JVBERi0xLjQK...', contentType: 'application/pdf' },
        ],
      };

      const result = await campaignService.initiateCampaign(input);

      expect(result.campaignId).toMatch(/^test-campaign-\d{14}$/);
      expect(result.hasEmbeddedImages).toBe(true);
      expect(result.attachmentsUploaded).toBe(1);

      // Verify template stored to S3 due to inline images
      expect(mockStorage.putObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining('templates/'),
          contentType: 'application/json',
        }),
      );

      // Verify attachment uploaded to S3
      expect(mockStorage.putObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining('campaigns/'),
          contentType: 'application/pdf',
        }),
      );

      // Verify SFN execution start
      expect(mockOrchestrator.startExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:EmailCampaign',
          name: expect.stringContaining('Campaign-'),
          input: expect.objectContaining({
            campaignName: 'test-campaign',
            groupId: 'recipients-my-list',
          }),
        }),
      );
    });
  });

  describe('setupCampaign', () => {
    it('should write campaign metadata to DynamoDB campaigns table', async () => {
      mockCampaignRepo.createCampaign.mockResolvedValue(undefined);

      const event = {
        campaignId: 'my-campaign-123',
        campaignName: 'campaign-cool',
        templateName: 'newsletter-template',
        senderEmail: 'admin@firminiq.com',
        senderName: 'Admin',
        attachments: [],
        templateS3Key: 'templates/my-campaign-123/template.json',
      };

      const result = await campaignService.setupCampaign(event);

      expect(result.campaignId).toBe('my-campaign-123');
      expect(result.templateS3Key).toBe('templates/my-campaign-123/template.json');

      expect(mockCampaignRepo.createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: 'my-campaign-123',
          campaignName: 'campaign-cool',
          status: 'PROCESSING',
        }),
      );
    });
  });

  describe('extractData', () => {
    it('should divide recipients list into S3 chunks and register batches', async () => {
      mockRecipientRepo.listRecipientsInGroup.mockResolvedValue([
        { groupId: 'group-1', emailAddress: 'a@example.com', createdAt: '2026' },
        { groupId: 'group-1', emailAddress: 'b@example.com', createdAt: '2026' },
        { groupId: 'group-1', emailAddress: 'c@example.com', createdAt: '2026' },
      ]);
      mockStorage.putObject.mockResolvedValue(undefined);
      mockCampaignRepo.createBatch.mockResolvedValue(undefined);
      mockCampaignRepo.getCampaign.mockResolvedValue(null);

      const event = {
        campaignId: 'campaign-abc',
        recipientListFile: 'group-1',
        templateName: 'temp-x',
        senderEmail: 's@example.com',
        senderName: 'Sender',
      };

      // Set small batchSize for testing chunking
      const originalBatchSize = environment.batchSize;
      environment.batchSize = 2;

      try {
        const result = await campaignService.extractData(event);

        expect(result.processedRecipients).toBe(3);
        expect(result.batchesCreated).toBe(2); // chunk size 2 -> 2 batches
        expect(result.batches.length).toBe(2);

        // Verify batch files written to S3
        expect(mockStorage.putObject).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'batches/campaign-abc/campaign-abc-batch-0001.json',
          }),
        );
        expect(mockStorage.putObject).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'batches/campaign-abc/campaign-abc-batch-0002.json',
          }),
        );

        // Verify batches registered in DB
        expect(mockCampaignRepo.createBatch).toHaveBeenCalledTimes(2);
      } finally {
        environment.batchSize = originalBatchSize;
      }
    });
  });

  describe('processBatch', () => {
    it('should queue items in SQS and update batch status in DB', async () => {
      process.env.MONITORING_STATE_MACHINE_ARN =
        'arn:aws:states:us-east-1:123456789012:stateMachine:EmailBatchMonitor';
      mockCampaignRepo.getBatch.mockResolvedValue({
        campaignId: 'campaign-abc',
        batchId: 'batch-1',
        status: 'PENDING',
        recipientCount: 3,
        s3Key: 'key',
        createdAt: '2026',
      });

      const batchJson = {
        destinations: [
          { email: 'a@example.com' },
          { email: 'b@example.com' },
          { email: 'c@example.com' },
        ],
        sender: { email: 's@e.com', name: 'S' },
        template: { name: 't' },
      };
      mockStorage.getObject.mockResolvedValue({ body: JSON.stringify(batchJson) });
      mockCampaignRepo.updateBatchStatus.mockResolvedValue(undefined);
      mockQueue.sendMessageBatch.mockResolvedValue({
        successful: ['id1', 'id2', 'id3'],
        failed: [],
      });
      mockOrchestrator.startExecution.mockResolvedValue({} as any);

      const event = {
        campaignId: 'campaign-abc',
        batchId: 'batch-1',
        objectKey: 'batches/campaign-abc/batch-1.json',
      };

      const result = await campaignService.processBatch(event);

      expect(result.messagesQueued).toBe(3);
      expect(result.status).toBe('QUEUED_FOR_SENDING');

      // Verify SQS batch sending
      expect(mockQueue.sendMessageBatch).toHaveBeenCalledTimes(1);

      // Verify batch monitoring start
      expect(mockOrchestrator.startExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:EmailBatchMonitor',
          input: expect.objectContaining({
            batchId: 'batch-1',
          }),
        }),
      );
    });
  });
});
