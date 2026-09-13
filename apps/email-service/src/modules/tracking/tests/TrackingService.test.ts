import { TrackingService } from '../services/TrackingService.js';
import { ICampaignRepository } from '../../../common/providers/ICampaignRepository.js';

describe('TrackingService', () => {
  let trackingService: TrackingService;
  let mockCampaignRepo: jest.Mocked<ICampaignRepository>;

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
    };

    trackingService = new TrackingService(mockCampaignRepo);
  });

  describe('checkCampaignStatus', () => {
    it('should return complete: true if there are zero batches', async () => {
      mockCampaignRepo.listBatchesForCampaign.mockResolvedValue([]);

      const result = await trackingService.checkCampaignStatus('camp-1');

      expect(result.allComplete).toBe(true);
      expect(result.progress).toBe('100%');
      expect(mockCampaignRepo.updateCampaignStatus).not.toHaveBeenCalled();
    });

    it('should return complete: false if some batches are still pending/processing', async () => {
      mockCampaignRepo.listBatchesForCampaign.mockResolvedValue([
        {
          campaignId: 'camp-1',
          batchId: 'b-1',
          status: 'COMPLETED',
          recipientCount: 1,
          createdAt: '',
          s3Key: '',
        },
        {
          campaignId: 'camp-1',
          batchId: 'b-2',
          status: 'IN_PROCESSING',
          recipientCount: 1,
          createdAt: '',
          s3Key: '',
        },
      ]);

      const result = await trackingService.checkCampaignStatus('camp-1');

      expect(result.allComplete).toBe(false);
      expect(result.completedBatches).toBe(1);
      expect(result.totalBatches).toBe(2);
      expect(result.progress).toBe('50%');
      expect(mockCampaignRepo.updateCampaignStatus).not.toHaveBeenCalled();
    });

    it('should update campaign status and return complete: true if all batches are completed', async () => {
      mockCampaignRepo.listBatchesForCampaign.mockResolvedValue([
        {
          campaignId: 'camp-1',
          batchId: 'b-1',
          status: 'COMPLETED',
          recipientCount: 1,
          createdAt: '',
          s3Key: '',
        },
        {
          campaignId: 'camp-1',
          batchId: 'b-2',
          status: 'COMPLETED_WITH_ERRORS',
          recipientCount: 1,
          createdAt: '',
          s3Key: '',
        },
      ]);
      mockCampaignRepo.updateCampaignStatus.mockResolvedValue(undefined);

      const result = await trackingService.checkCampaignStatus('camp-1');

      expect(result.allComplete).toBe(true);
      expect(result.completedBatches).toBe(2);
      expect(result.progress).toBe('100%');
      expect(mockCampaignRepo.updateCampaignStatus).toHaveBeenCalledWith('camp-1', 'COMPLETED');
    });
  });

  describe('checkBatchStatus', () => {
    it('should return complete: false, shouldContinue: false when timeout is reached', async () => {
      const event = {
        batchId: 'b-1',
        campaignId: 'c-1',
        totalMessages: 100,
        waitIterations: 600, // equal to default maxIterations
        maxWaitMinutes: 600,
      };

      const result = await trackingService.checkBatchStatus(event);

      expect(result.isComplete).toBe(false);
      expect(result.shouldContinue).toBe(false);
      expect(mockCampaignRepo.getBatch).not.toHaveBeenCalled();
    });

    it('should return complete: false, shouldContinue: false when batch not found', async () => {
      mockCampaignRepo.getBatch.mockResolvedValue(null);

      const event = {
        batchId: 'b-missing',
        campaignId: 'c-1',
        waitIterations: 0,
      };

      const result = await trackingService.checkBatchStatus(event);

      expect(result.isComplete).toBe(false);
      expect(result.shouldContinue).toBe(false);
      expect(mockCampaignRepo.getBatch).toHaveBeenCalledWith('c-1', 'b-missing');
    });

    it('should increment waitIterations and return shouldContinue: true when batch is still processing', async () => {
      mockCampaignRepo.getBatch.mockResolvedValue({
        campaignId: 'c-1',
        batchId: 'b-1',
        status: 'QUEUED_FOR_SENDING',
        recipientCount: 10,
        queuedCount: 10,
        sentCount: 4,
        failedCount: 1,
        createdAt: '',
        s3Key: '',
      });

      const event = {
        batchId: 'b-1',
        campaignId: 'c-1',
        waitIterations: 5,
      };

      const result = await trackingService.checkBatchStatus(event);

      expect(result.isComplete).toBe(false);
      expect(result.shouldContinue).toBe(true);
      expect(result.waitIterations).toBe(6);
      expect(result.progress).toBe('50%'); // (4 + 1) / 10 = 50%
      expect(mockCampaignRepo.updateBatchStatus).not.toHaveBeenCalled();
    });

    it('should update batch status and return isComplete: true when batch processing finished', async () => {
      mockCampaignRepo.getBatch.mockResolvedValue({
        campaignId: 'c-1',
        batchId: 'b-1',
        status: 'QUEUED_FOR_SENDING',
        recipientCount: 10,
        queuedCount: 10,
        sentCount: 9,
        failedCount: 1,
        createdAt: '',
        s3Key: '',
      });
      mockCampaignRepo.updateBatchStatus.mockResolvedValue(undefined);

      const event = {
        batchId: 'b-1',
        campaignId: 'c-1',
        waitIterations: 5,
      };

      const result = await trackingService.checkBatchStatus(event);

      expect(result.isComplete).toBe(true);
      expect(result.shouldContinue).toBe(false);
      expect(result.progress).toBe('100%');
      expect(mockCampaignRepo.updateBatchStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: 'c-1',
          batchId: 'b-1',
          status: 'COMPLETED_WITH_ERRORS', // Since there was 1 failure
        }),
      );
    });
  });
});
