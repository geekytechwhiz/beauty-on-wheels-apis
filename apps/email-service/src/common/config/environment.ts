export interface EnvironmentConfig {
  awsRegion: string;
  allowedOrigin: string;
  recipientsBucket: string;
  emailBatchBucket: string;
  attachmentsBucket: string;
  emailQueueUrl: string;
  registryTable: string;
  campaignsTable: string;
  campaignBatchesTable: string;
  recipientTrackingTable: string;
  recipientsTable: string;
  contactListName: string | null;
  topicName: string;
  emailRateLimit: number;
  batchSize: number;
  defaultFromEmail: string;
  defaultFromName: string;
  vendorOnboardingTemplateName: string;
  vendorEmailConfirmationTemplateName: string;
  bookingConfirmedTemplateName: string;
  emailNotificationQueueUrl: string;
  emailNotificationDlqUrl: string;
  isOffline: boolean;
  dynamodbEndpoint?: string;
  s3Endpoint?: string;
  sqsEndpoint?: string;
  sesEndpoint?: string;
  sfnEndpoint?: string;
}

export const environment: EnvironmentConfig = {
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  recipientsBucket: process.env.RECIPIENTS_BUCKET || '',
  emailBatchBucket: process.env.BATCH_BUCKET || '',
  attachmentsBucket: process.env.ATTACHMENTS_BUCKET || '',
  emailQueueUrl: process.env.EMAIL_QUEUE_URL || '',
  registryTable: process.env.REGISTRY_TABLE || 'RecipientTablesRegistry',
  campaignsTable: process.env.CAMPAIGNS_TABLE || 'Campaigns',
  campaignBatchesTable: process.env.CAMPAIGN_BATCHES_TABLE || 'CampaignBatches',
  recipientTrackingTable: process.env.RECIPIENT_TRACKING_TABLE || 'RecipientTracking',
  recipientsTable: process.env.RECIPIENTS_TABLE || 'Recipients',
  contactListName: process.env.CONTACT_LIST_NAME?.trim() || null,
  topicName: process.env.TOPIC_NAME || '',
  emailRateLimit: parseInt(process.env.EMAIL_RATE_LIMIT || '50', 10),
  batchSize: parseInt(process.env.BATCH_SIZE || '1000', 10),
  defaultFromEmail: process.env.DEFAULT_FROM_EMAIL || '',
  defaultFromName: process.env.DEFAULT_FROM_NAME || 'Beauty on Wheels',
  vendorOnboardingTemplateName:
    process.env.VENDOR_ONBOARDING_TEMPLATE_NAME || 'VendorOnboardingSubmitted',
  vendorEmailConfirmationTemplateName:
    process.env.VENDOR_EMAIL_CONFIRMATION_TEMPLATE_NAME ||
    'vendor_email_confirmation',
  bookingConfirmedTemplateName:
    process.env.BOOKING_CONFIRMED_TEMPLATE_NAME || 'BookingConfirmed',
  emailNotificationQueueUrl: process.env.EMAIL_NOTIFICATION_QUEUE_URL || '',
  emailNotificationDlqUrl:
    process.env.DLQ_QUEUE_URL || process.env.EMAIL_NOTIFICATION_DLQ_URL || '',
  isOffline: process.env.IS_OFFLINE === 'true',
  dynamodbEndpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
  s3Endpoint: process.env.S3_ENDPOINT || 'http://localhost:4569',
  sqsEndpoint: process.env.SQS_ENDPOINT || 'http://localhost:9324',
  sesEndpoint: process.env.SES_ENDPOINT || 'http://localhost:8005',
  sfnEndpoint: process.env.SFN_ENDPOINT || 'http://localhost:8083',
};
