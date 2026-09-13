import { ICampaignRepository } from '../../../common/providers/ICampaignRepository.js';
import { CampaignStatusResult, BatchStatusResult } from '../domain/types.js';
import { logger } from '../../../common/utils/logger.js';

export class TrackingService {
  constructor(private campaignRepo: ICampaignRepository) {}

  async checkCampaignStatus(campaignId: string): Promise<CampaignStatusResult> {
    logger.info(`Checking status for campaign: ${campaignId}`);

    const batches = await this.campaignRepo.listBatchesForCampaign(campaignId);
    const totalBatches = batches.length;

    if (totalBatches === 0) {
      return {
        campaignId,
        completedBatches: 0,
        totalBatches: 0,
        allComplete: true,
        progress: '100%',
      };
    }

    let completedBatches = 0;
    for (const batch of batches) {
      if (['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(batch.status)) {
        completedBatches++;
      }
    }

    const allComplete = completedBatches === totalBatches;
    const progressPct = Math.floor((completedBatches * 100) / totalBatches);

    if (allComplete) {
      logger.info(`Campaign ${campaignId} has finished processing all batches`);
      await this.campaignRepo.updateCampaignStatus(campaignId, 'COMPLETED');
    }

    return {
      campaignId,
      completedBatches,
      totalBatches,
      allComplete,
      progress: `${progressPct}%`,
    };
  }

  async checkBatchStatus(event: any): Promise<BatchStatusResult> {
    const batchId = event.batchId;
    const campaignId = event.campaignId;
    const totalMessages = parseInt(event.totalMessages || '0', 10);
    const waitIterations = parseInt(event.waitIterations || '0', 10);
    const maxWaitMinutes = parseInt(event.maxWaitMinutes || '600', 10);

    logger.info(`Checking batch status for ${batchId}`, { waitIterations });

    // Handle timeout
    const checkIntervalSeconds = 60;
    const maxIterations = (maxWaitMinutes * 60) / checkIntervalSeconds;

    const baseResult = {
      batchId,
      campaignId,
      totalMessages,
      sentCount: 0,
      failedCount: 0,
      waitIterations,
      progress: '0%',
    };

    if (waitIterations >= maxIterations) {
      logger.warn(`Reached maximum wait time monitoring batch ${batchId}`);
      return {
        ...baseResult,
        isComplete: false,
        shouldContinue: false,
      };
    }

    const batchInfo = await this.campaignRepo.getBatch(campaignId, batchId);
    if (!batchInfo) {
      logger.error(`Batch ${batchId} not found in database`);
      return {
        ...baseResult,
        isComplete: false,
        shouldContinue: false,
      };
    }

    const queuedCount = batchInfo.queuedCount || batchInfo.recipientCount || 0;
    const sentCount = batchInfo.sentCount || 0;
    const failedCount = batchInfo.failedCount || 0;
    const totalProcessed = sentCount + failedCount;

    const progressPct = queuedCount > 0 ? Math.floor((totalProcessed * 100) / queuedCount) : 0;

    const updatedResult = {
      ...baseResult,
      sentCount,
      failedCount,
      totalMessages: queuedCount,
      progress: `${progressPct}%`,
    };

    if (totalProcessed >= queuedCount && queuedCount > 0) {
      // Batch finished
      const finalStatus = failedCount === 0 ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS';
      logger.info(`Batch ${batchId} completed processing with status: ${finalStatus}`);

      await this.campaignRepo.updateBatchStatus({
        campaignId,
        batchId,
        status: finalStatus,
        processingEndTime: new Date().toISOString(),
      });

      return {
        ...updatedResult,
        isComplete: true,
        shouldContinue: false,
      };
    }

    // Batch still processing
    return {
      ...updatedResult,
      isComplete: false,
      shouldContinue: true,
      waitIterations: waitIterations + 1,
    };
  }
}
