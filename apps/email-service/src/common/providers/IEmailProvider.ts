export interface SendEmailOptions {
  fromEmail: string;
  fromName?: string;
  toAddresses: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  replyToAddresses?: string[];
  subject: string;
  htmlBody?: string;
  textBody?: string;
  attachments?: EmailAttachment[];
  contactListName?: string | null;
  topicName?: string;
  unsubscribePlaceholderFound?: boolean;
  configurationSetName?: string;
  emailTags?: Array<{ name: string; value: string }>;
}

export interface SendTemplatedEmailOptions {
  fromEmail: string;
  fromName?: string;
  toAddresses: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  replyToAddresses?: string[];
  templateName: string;
  templateData: Record<string, any>;
  attachments?: EmailAttachment[];
  contactListName?: string | null;
  topicName?: string;
  unsubscribePlaceholderFound?: boolean;
  configurationSetName?: string;
  emailTags?: Array<{ name: string; value: string }>;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  rawContent: Buffer;
  contentDisposition?: 'ATTACHMENT' | 'INLINE';
  contentId?: string;
}

export interface TopicMetadata {
  TopicName: string;
  DisplayName?: string;
  Description?: string;
  DefaultSubscriptionStatus: string;
}

export interface IEmailProvider {
  sendEmail(options: SendEmailOptions): Promise<{ messageId: string }>;
  sendTemplatedEmail(options: SendTemplatedEmailOptions): Promise<{ messageId: string }>;
  listVerifiedEmails(): Promise<string[]>;
  listTopics(contactListName: string): Promise<TopicMetadata[]>;
}
