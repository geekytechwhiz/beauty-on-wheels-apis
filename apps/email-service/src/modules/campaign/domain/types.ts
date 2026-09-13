export interface Campaign {
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

export interface CampaignBatch {
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
}

export interface AttachmentInfo {
  filename: string;
  s3Key: string;
  contentType: string;
}

export interface BatchManifest {
  campaignId: string;
  totalRecipients: number;
  createdAt: string;
  sender: {
    email: string;
    name: string;
  };
  template: {
    name: string;
    version: string;
  };
  batches: Array<{
    batchId: string;
    objectKey: string;
    recipientCount: number;
    recipientTrackingTable: string;
    batchTrackingTable: string;
  }>;
  isComplete: boolean;
  processingTimeSeconds?: number;
}
