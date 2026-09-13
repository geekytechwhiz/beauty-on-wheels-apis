export interface CampaignStatusResult {
  campaignId: string;
  completedBatches: number;
  totalBatches: number;
  allComplete: boolean;
  progress: string;
}

export interface BatchStatusResult {
  batchId: string;
  campaignId: string;
  totalMessages: number;
  sentCount: number;
  failedCount: number;
  isComplete: boolean;
  shouldContinue: boolean;
  waitIterations: number;
  progress: string;
}
