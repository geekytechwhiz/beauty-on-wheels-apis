import {
  BOOKING_CONFIRMED_EVENT_TYPE,
  VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
  VENDOR_ONBOARDING_EVENT_TYPE,
} from '@api-hub/event-platform';

import { IEmailProvider, EmailAttachment } from '../../../common/providers/IEmailProvider.js';
import { ITemplateRegistryProvider } from '../../../common/providers/ITemplateRegistryProvider.js';
import { IStorageProvider } from '../../../common/providers/IStorageProvider.js';
import { ICampaignRepository } from '../../../common/providers/ICampaignRepository.js';
import { environment } from '../../../common/config/environment.js';
import {
  AdhocEmailRequest,
  BookingConfirmedEmailInput,
  BulkEmailMessage,
  EventNotificationEmailInput,
  VendorEmailVerificationRequestedEmailInput,
  VendorOnboardingSubmittedEmailInput,
} from '../domain/types.js';
import { resolveNotificationTemplateName } from '../domain/notification-templates.js';
import { logger } from '../../../common/utils/logger.js';
import crypto from 'crypto';

export class EmailService {
  constructor(
    private emailProvider: IEmailProvider,
    private templateRegistry: ITemplateRegistryProvider,
    private storage: IStorageProvider,
    private campaignRepo: ICampaignRepository,
  ) {}

  // 1. Send Individual (Adhoc) Email
  async sendAdhocEmail(input: AdhocEmailRequest): Promise<{ messageId: string }> {
    const toAddresses = Array.isArray(input.to) ? input.to : [input.to];
    const ccAddresses = input.cc || undefined;
    const bccAddresses = input.bcc || undefined;
    const replyToAddresses = input.replyTo || undefined;

    // Process attachments
    const attachments: EmailAttachment[] = [];
    if (input.attachments && input.attachments.length > 0) {
      const timestamp = this.getFormattedTimestamp();

      for (const att of input.attachments) {
        const fileBuffer = Buffer.from(att.content, 'base64');
        const s3Key = `adhoc/${timestamp}/attachments/${att.filename}`;

        // Upload attachment to S3 for audit log / tracking
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

        logger.info(`Uploaded adhoc attachment to S3: ${s3Key}`);

        attachments.push({
          filename: att.filename,
          contentType: att.contentType,
          rawContent: fileBuffer,
          contentDisposition: 'ATTACHMENT',
        });
      }
    }

    if (input.templateName) {
      // --- Template-based Sending ---
      if (input.htmlContent || input.textContent) {
        const error: any = new Error('Raw email content (htmlContent/textContent) cannot be specified when using a template');
        error.statusCode = 400;
        throw error;
      }

      logger.info(`Sending adhoc templated email to ${toAddresses.join(', ')} using template ${input.templateName} from ${input.from}`);

      let unsubscribePlaceholderFound = false;
      try {
        const registryTemplate = await this.templateRegistry.getTemplate(input.templateName);
        const htmlPart = registryTemplate.htmlContent || '';
        const textPart = registryTemplate.textContent || '';
        unsubscribePlaceholderFound =
          htmlPart.includes('{{amazonSESUnsubscribeUrl}}') ||
          textPart.includes('{{amazonSESUnsubscribeUrl}}');
      } catch (err) {
        logger.warn(`Could not verify template ${input.templateName} placeholder in registry`, { err });
      }

      const result = await this.emailProvider.sendTemplatedEmail({
        fromEmail: input.from,
        fromName: input.fromName || 'Email System',
        toAddresses,
        ccAddresses,
        bccAddresses,
        replyToAddresses,
        templateName: input.templateName,
        templateData: input.templateData || {},
        attachments: attachments.length > 0 ? attachments : undefined,
        unsubscribePlaceholderFound,
        contactListName: input.contactListName || environment.contactListName,
        topicName: input.topicName || environment.topicName,
      });

      return { messageId: result.messageId };
    } else {
      // --- Raw Email Sending ---
      if (!input.subject) {
        const error: any = new Error('Subject is required for raw email');
        error.statusCode = 400;
        throw error;
      }
      if (!input.htmlContent && !input.textContent) {
        const error: any = new Error('Either htmlContent or textContent is required');
        error.statusCode = 400;
        throw error;
      }

      logger.info(`Sending adhoc raw email to ${toAddresses.join(', ')} from ${input.from}`);

      // Parse embedded HTML images to CID attachments
      let htmlBody = input.htmlContent || '';
      const embeddedAttachments: EmailAttachment[] = [];

      if (htmlBody) {
        const parsed = this.extractEmbeddedImages(htmlBody);
        htmlBody = parsed.html;
        embeddedAttachments.push(...parsed.attachments);
      }

      // Combine attachments
      const allAttachments = [...attachments, ...embeddedAttachments];

      // Trigger SES email send
      const result = await this.emailProvider.sendEmail({
        fromEmail: input.from,
        fromName: input.fromName || 'Email System',
        toAddresses,
        ccAddresses,
        bccAddresses,
        replyToAddresses,
        subject: input.subject,
        htmlBody: htmlBody || undefined,
        textBody: input.textContent || undefined,
        attachments: allAttachments.length > 0 ? allAttachments : undefined,
        contactListName: input.contactListName || environment.contactListName,
        topicName: input.topicName || environment.topicName,
      });

      return { messageId: result.messageId };
    }
  }

  // 2. Send Bulk Email from SQS Event
  async sendBulkEmail(message: BulkEmailMessage): Promise<void> {
    const email = message.recipient.email;
    const campaignId = message.campaignId;
    const batchId = message.batchId;

    logger.info(`Processing SQS message bulk send for ${email} in campaign ${campaignId}`);

    // Check if email already sent (idempotency check)
    const existingTracking = await this.campaignRepo.getRecipientTracking(campaignId, email);
    if (existingTracking && existingTracking.status === 'SENT') {
      logger.info(`Email already sent to ${email} for campaign ${campaignId}. Skipping.`);
      return;
    }

    const attempts = existingTracking ? existingTracking.attempts : 0;
    const dateStr = new Date().toISOString();
    const expirationTime = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days TTL

    try {
      let messageId = '';
      const emailAttachments: EmailAttachment[] = [];

      // Download S3 attachments if they exist
      if (message.attachments && message.attachments.length > 0) {
        for (const att of message.attachments) {
          logger.info(`Downloading S3 attachment for ${email}: ${att.filename}`);
          const buffer = await this.storage.getObjectAsBuffer(
            environment.attachmentsBucket,
            att.s3Key,
          );
          emailAttachments.push({
            filename: att.filename,
            contentType: att.contentType,
            rawContent: buffer,
            contentDisposition: 'ATTACHMENT',
          });
        }
      }

      if (message.templateS3Key) {
        // Simple email style using copy template from S3 (has embedded images)
        logger.info(`Loading campaign template from S3: ${message.templateS3Key}`);
        const templateObject = await this.storage.getObject(
          environment.attachmentsBucket,
          message.templateS3Key,
        );
        const templateData = JSON.parse(templateObject.body);

        let subject = templateData.subject || '';
        let htmlBody = templateData.htmlContent || '';
        let textBody = templateData.textContent || '';

        // Variable substitution
        const firstName = message.recipient.metadata?.firstName || '';
        const lastName = message.recipient.metadata?.lastName || '';

        subject = subject.replace(/{{firstName}}/g, firstName).replace(/{{lastName}}/g, lastName);
        htmlBody = htmlBody.replace(/{{firstName}}/g, firstName).replace(/{{lastName}}/g, lastName);
        textBody = textBody.replace(/{{firstName}}/g, firstName).replace(/{{lastName}}/g, lastName);

        // Extract embedded base64 HTML images to inline CIDs
        const parsed = this.extractEmbeddedImages(htmlBody);
        htmlBody = parsed.html;
        const inlineAttachments = parsed.attachments;

        const allAttachments = [...emailAttachments, ...inlineAttachments];

        const sendResult = await this.emailProvider.sendEmail({
          fromEmail: message.sender.email,
          fromName: message.sender.name,
          toAddresses: [email],
          subject,
          htmlBody: htmlBody || undefined,
          textBody: textBody || undefined,
          attachments: allAttachments.length > 0 ? allAttachments : undefined,
          contactListName: environment.contactListName,
          topicName: message.topicName || environment.topicName,
        });

        messageId = sendResult.messageId;
      } else {
        // Standard template registry style using SES Native Templating
        const templateName = message.template.name;
        let unsubscribePlaceholderFound = false;

        try {
          const registryTemplate = await this.templateRegistry.getTemplate(templateName);
          const htmlPart = registryTemplate.htmlContent || '';
          const textPart = registryTemplate.textContent || '';
          unsubscribePlaceholderFound =
            htmlPart.includes('{{amazonSESUnsubscribeUrl}}') ||
            textPart.includes('{{amazonSESUnsubscribeUrl}}');
        } catch (err) {
          logger.warn(`Could not verify template ${templateName} placeholder in registry`, { err });
        }

        const templateData = {
          firstName: message.recipient.metadata?.firstName || '',
          lastName: message.recipient.metadata?.lastName || '',
        };

        const sendResult = await this.emailProvider.sendTemplatedEmail({
          fromEmail: message.sender.email,
          fromName: message.sender.name,
          toAddresses: [email],
          templateName,
          templateData,
          attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
          contactListName: environment.contactListName,
          topicName: message.topicName || environment.topicName,
          unsubscribePlaceholderFound,
        });

        messageId = sendResult.messageId;
      }

      // Log delivery success in recipient tracking
      await this.campaignRepo.createOrUpdateRecipientTracking({
        campaignId,
        emailAddress: email,
        batchId,
        status: 'SENT',
        sentTimestamp: dateStr,
        attempts: attempts + 1,
        messageId,
        expirationTime,
      });

      // Increment batch success count in DynamoDB
      await this.campaignRepo.incrementBatchCounts({
        campaignId,
        batchId,
        sentIncrement: 1,
        failedIncrement: 0,
      });

      logger.info(`Successfully sent bulk email to ${email} for batch ${batchId}`);
    } catch (error: any) {
      logger.error(`Failed bulk email delivery to ${email} for batch ${batchId}`, { error });

      // Log failure tracking in recipient tracking
      await this.campaignRepo.createOrUpdateRecipientTracking({
        campaignId,
        emailAddress: email,
        batchId,
        status: 'FAILED',
        errorMessage: error.message || 'Unknown send error',
        attempts: attempts + 1,
        expirationTime,
      });

      // Increment batch failed count in DynamoDB
      await this.campaignRepo.incrementBatchCounts({
        campaignId,
        batchId,
        sentIncrement: 0,
        failedIncrement: 1,
      });

      // Re-throw the error so SQS dead-letter logic / retries apply
      throw error;
    }
  }

  // 3. List Verified Sender Emails
  async listVerifiedEmails(): Promise<string[]> {
    return this.emailProvider.listVerifiedEmails();
  }

  // 4. List Topics of a Contact List
  async listTopics(): Promise<any[]> {
    const contactListName = environment.contactListName;
    if (!contactListName) {
      return [];
    }
    return this.emailProvider.listTopics(contactListName);
  }

  async sendEventNotificationEmail(
    input: EventNotificationEmailInput,
  ): Promise<{ messageId: string }> {
    const fromEmail = environment.defaultFromEmail;
    if (!fromEmail) {
      throw new Error('DEFAULT_FROM_EMAIL is not configured');
    }

    const templateName = resolveNotificationTemplateName(input.eventType);
    logger.info('Resolving event notification template', {
      eventType: input.eventType,
      templateName,
    });

    return this.sendAdhocEmail({
      to: input.to,
      from: fromEmail,
      fromName: environment.defaultFromName,
      templateName,
      templateData: input.templateData,
    });
  }

  async sendVendorOnboardingSubmittedEmail(
    input: VendorOnboardingSubmittedEmailInput,
  ): Promise<{ messageId: string }> {
    logger.info('Sending vendor onboarding submitted email', {
      applicationId: input.applicationId,
      vendorId: input.vendorId,
    });

    return this.sendEventNotificationEmail({
      eventType: VENDOR_ONBOARDING_EVENT_TYPE,
      to: input.email,
      templateData: {
        applicationId: input.applicationId,
        vendorId: input.vendorId,
        businessName: input.businessName || '',
      },
    });
  }

  async sendVendorEmailVerificationRequestedEmail(
    input: VendorEmailVerificationRequestedEmailInput,
  ): Promise<{ messageId: string }> {
    logger.info('Sending vendor email confirmation', {
      vendorId: input.vendorId,
    });

    return this.sendEventNotificationEmail({
      eventType: VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
      to: input.email,
      templateData: {
        firstName: input.firstName,
        otp: input.otp,
        expiryMinutes: input.expiryMinutes,
      },
    });
  }

  async sendBookingConfirmedEmail(
    input: BookingConfirmedEmailInput,
  ): Promise<{ messageId: string }> {
    logger.info('Sending booking confirmed email', {
      bookingId: input.bookingId,
      vendorId: input.vendorId,
    });

    return this.sendEventNotificationEmail({
      eventType: BOOKING_CONFIRMED_EVENT_TYPE,
      to: input.customerEmail,
      templateData: {
        bookingId: input.bookingId,
        vendorId: input.vendorId,
        bookingDate: input.bookingDate,
        slotId: input.slotId,
        totalAmount: input.totalAmount ?? '',
        customerName: input.customerName || '',
        vendorName: input.vendorName || '',
      },
    });
  }

  // --- Helper Methods ---
  private getFormattedTimestamp(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}-${min}`;
  }

  private extractEmbeddedImages(htmlContent: string): {
    html: string;
    attachments: EmailAttachment[];
  } {
    const attachments: EmailAttachment[] = [];
    const dataUrlPattern = /<img[^>]+src="data:([^;]+);base64,([^"]+)"[^>]*>/g;

    const html = htmlContent.replace(dataUrlPattern, (match, mimeType, base64Data) => {
      const contentId = crypto.randomUUID();
      const extensionMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
      };
      const ext = extensionMap[mimeType] || 'bin';
      const filename = `embedded_image_${contentId}.${ext}`;
      const buffer = Buffer.from(base64Data, 'base64');

      attachments.push({
        filename,
        contentType: mimeType,
        rawContent: buffer,
        contentDisposition: 'INLINE',
        contentId,
      });

      return match.replace(`data:${mimeType};base64,${base64Data}`, `cid:${contentId}`);
    });

    return { html, attachments };
  }
}
