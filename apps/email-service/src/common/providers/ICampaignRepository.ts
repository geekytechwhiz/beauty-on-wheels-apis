export interface CampaignRecord {
  campaignId: string;
  campaignName: string;
  templateName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  totalRecipients?: number;
  senderEmail: string;
  senderName: string;
  topicName?: string;
  attachmentsCount?: number;
  hasEmbeddedImages?: boolean;
}

export interface CampaignBatchRecord {
  campaignId: string;
  batchId: string;
  status:
    | 'PENDING'
    | 'IN_PROCESSING'
    | 'QUEUED_FOR_SENDING'
    | 'COMPLETED'
    | 'COMPLETED_WITH_ERRORS'
    | 'FAILED';
  recipientCount: number;
  queuedCount?: number;
  sentCount?: number;
  failedCount?: number;
  s3Key: string;
  createdAt: string;
  processingStartTime?: string;
  processingEndTime?: string;
  queuedTime?: string;
  errorMessage?: string;
  expirationTime?: number;
}

export interface RecipientTrackingRecord {
  campaignId: string;
  emailAddress: string;
  batchId: string;
  status: 'SENT' | 'FAILED' | 'PENDING';
  sentTimestamp?: string;
  errorMessage?: string;
  attempts: number;
  messageId?: string;
  expirationTime?: number;
}

export interface ICampaignRepository {
  // Campaign Metadata
  createCampaign(campaign: CampaignRecord): Promise<void>;
  getCampaign(campaignId: string): Promise<CampaignRecord | null>;
  updateCampaignStatus(campaignId: string, status: string): Promise<void>;

  // Batch Tracking
  createBatch(batch: CampaignBatchRecord): Promise<void>;
  getBatch(campaignId: string, batchId: string): Promise<CampaignBatchRecord | null>;
  updateBatchStatus(options: {
    campaignId: string;
    batchId: string;
    status: CampaignBatchRecord['status'];
    processingStartTime?: string;
    processingEndTime?: string;
    queuedTime?: string;
    queuedCount?: number;
    errorMessage?: string;
  }): Promise<void>;
  incrementBatchCounts(options: {
    campaignId: string;
    batchId: string;
    sentIncrement: number;
    failedIncrement: number;
  }): Promise<void>;
  listBatchesForCampaign(campaignId: string): Promise<CampaignBatchRecord[]>;

  // Recipient Tracking
  createOrUpdateRecipientTracking(record: RecipientTrackingRecord): Promise<void>;
  getRecipientTracking(
    campaignId: string,
    emailAddress: string,
  ): Promise<RecipientTrackingRecord | null>;
}
