export interface AdhocAttachment {
  filename: string;
  content: string; // Base64
  contentType: string;
}

export interface AdhocEmailRequest {
  to: string | string[];
  from: string;
  fromName?: string;
  subject?: string;
  htmlContent?: string;
  textContent?: string;
  templateName?: string;
  templateData?: Record<string, any>;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  attachments?: AdhocAttachment[];
  contactListName?: string;
  topicName?: string;
}

export interface BulkEmailMessage {
  batchId: string;
  campaignId: string;
  recipientTrackingTable: string;
  batchTrackingTable: string;
  recipient: {
    email: string;
    metadata?: {
      firstName?: string;
      lastName?: string;
      emailId?: string;
    };
  };
  sender: {
    email: string;
    name?: string;
  };
  template: {
    name: string;
    version?: string;
  };
  attachments?: Array<{
    filename: string;
    s3Key: string;
    contentType: string;
  }>;
  topicName?: string;
  templateS3Key?: string;
  attempts: number;
  messageId: string;
}

export interface VendorOnboardingSubmittedEmailInput {
  applicationId: string;
  vendorId: string;
  ownerUserId: string;
  email: string;
  onboardingStatus: 'PENDING_REVIEW';
  businessName?: string;
}

export interface VendorEmailVerificationRequestedEmailInput {
  vendorId: string;
  verificationRequestId: string;
  ownerUserId: string;
  email: string;
  ownerName: string;
  businessName: string;
  verificationUrl: string;
  vendorStatus: 'PENDING_VERIFICATION';
  applicationId?: string;
}

export interface BookingConfirmedEmailInput {
  bookingId: string;
  customerId: string;
  vendorId: string;
  customerEmail: string;
  bookingDate: string;
  slotId: string;
  bookingStatus: 'confirmed';
  totalAmount?: number;
  customerName?: string;
  vendorName?: string;
}

export interface EventNotificationEmailInput {
  eventType: string;
  to: string;
  templateData: Record<string, unknown>;
}
