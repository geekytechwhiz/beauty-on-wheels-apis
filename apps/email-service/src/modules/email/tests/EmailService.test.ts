import { EmailService } from '../services/EmailService.js';
import { IEmailProvider } from '../../../common/providers/IEmailProvider.js';
import { ITemplateRegistryProvider } from '../../../common/providers/ITemplateRegistryProvider.js';
import { IStorageProvider } from '../../../common/providers/IStorageProvider.js';
import { ICampaignRepository } from '../../../common/providers/ICampaignRepository.js';
import { environment } from '../../../common/config/environment.js';
import { MemoryEmailDeliveryStore } from '../idempotency/email-delivery-store.js';

describe('EmailService', () => {
  let emailService: EmailService;
  let mockEmailProvider: jest.Mocked<IEmailProvider>;
  let mockTemplateRegistry: jest.Mocked<ITemplateRegistryProvider>;
  let mockStorage: jest.Mocked<IStorageProvider>;
  let mockCampaignRepo: jest.Mocked<ICampaignRepository>;

  beforeEach(() => {
    mockEmailProvider = {
      sendEmail: jest.fn(),
      sendTemplatedEmail: jest.fn(),
      listVerifiedEmails: jest.fn(),
      listTopics: jest.fn(),
    };

    mockTemplateRegistry = {
      createTemplate: jest.fn(),
      getTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
      listTemplates: jest.fn(),
    };

    mockStorage = {
      putObject: jest.fn(),
      getObject: jest.fn(),
      getObjectAsBuffer: jest.fn(),
      generatePresignedUploadUrl: jest.fn(),
    };

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

    environment.sesConfigurationSet = 'test-email-delivery';
    emailService = new EmailService(
      mockEmailProvider,
      mockTemplateRegistry,
      mockStorage,
      mockCampaignRepo,
      new MemoryEmailDeliveryStore(),
    );
  });

  describe('sendAdhocEmail', () => {
    it('should upload adhoc attachments, extract embedded images, and send email (Raw Email)', async () => {
      mockStorage.putObject.mockResolvedValue(undefined);
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-adhoc-123' });

      const request = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Hi!',
        htmlContent:
          '<html><body>Hello<img src="data:image/png;base64,iVBORw0KGgo=" /></body></html>',
        attachments: [{ filename: 'test.txt', content: 'SGVsbG8=', contentType: 'text/plain' }],
      };

      const result = await emailService.sendAdhocEmail(request);

      expect(result.messageId).toBe('msg-adhoc-123');

      // Check S3 attachment upload
      expect(mockStorage.putObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining('adhoc/'),
          contentType: 'text/plain',
        }),
      );

      // Check email provider send call
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          fromEmail: 'sender@example.com',
          toAddresses: ['recipient@example.com'],
          subject: 'Hi!',
          attachments: expect.arrayContaining([
            expect.objectContaining({ filename: 'test.txt' }),
            expect.objectContaining({ contentDisposition: 'INLINE', contentType: 'image/png' }),
          ]),
          configurationSetName: 'test-email-delivery',
        }),
      );
    });

    it('should throw error if both HTML and Text content are missing in raw mode', async () => {
      const request = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Hi!',
      };

      const promise = emailService.sendAdhocEmail(request);
      await expect(promise).rejects.toThrow('Either htmlContent or textContent is required');
      await expect(promise).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('should throw error if subject is missing in raw mode', async () => {
      const request = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        htmlContent: 'Hello',
      };

      const promise = emailService.sendAdhocEmail(request);
      await expect(promise).rejects.toThrow('Subject is required for raw email');
      await expect(promise).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('should throw error if raw content is specified in template mode', async () => {
      const request = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        templateName: 'WelcomeTemplate',
        htmlContent: 'Hello',
      };

      const promise = emailService.sendAdhocEmail(request);
      await expect(promise).rejects.toThrow('Raw email content (htmlContent/textContent) cannot be specified when using a template');
      await expect(promise).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('should send templated email successfully and handle list management checks', async () => {
      mockStorage.putObject.mockResolvedValue(undefined);
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'WelcomeTemplate',
        subject: 'Welcome!',
        htmlContent: 'Hello {{name}} {{amazonSESUnsubscribeUrl}}',
      });
      mockEmailProvider.sendTemplatedEmail.mockResolvedValue({ messageId: 'msg-templated-123' });

      const request = {
        to: ['recipient1@example.com', 'recipient2@example.com'],
        from: 'sender@example.com',
        templateName: 'WelcomeTemplate',
        templateData: { name: 'John' },
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        replyTo: ['replyto@example.com'],
        attachments: [{ filename: 'doc.pdf', content: 'JVBERi0xLjQK...', contentType: 'application/pdf' }],
      };

      const result = await emailService.sendAdhocEmail(request);

      expect(result.messageId).toBe('msg-templated-123');

      // Check S3 attachment upload
      expect(mockStorage.putObject).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'application/pdf',
        }),
      );

      // Verify getTemplate was called to check for unsubscribe placeholder
      expect(mockTemplateRegistry.getTemplate).toHaveBeenCalledWith('WelcomeTemplate');

      // Check email provider sendTemplatedEmail call
      expect(mockEmailProvider.sendTemplatedEmail).toHaveBeenCalledWith({
        fromEmail: 'sender@example.com',
        fromName: 'Email System',
        toAddresses: ['recipient1@example.com', 'recipient2@example.com'],
        ccAddresses: ['cc@example.com'],
        bccAddresses: ['bcc@example.com'],
        replyToAddresses: ['replyto@example.com'],
        templateName: 'WelcomeTemplate',
        templateData: { name: 'John' },
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: 'doc.pdf', contentType: 'application/pdf' }),
        ]),
        unsubscribePlaceholderFound: true,
        contactListName: null,
        topicName: '',
        configurationSetName: 'test-email-delivery',
      });
    });

    it('should send templated email using custom contactListName and topicName specified in the request', async () => {
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'WelcomeTemplate',
        subject: 'Welcome!',
        htmlContent: 'Hello {{name}} {{amazonSESUnsubscribeUrl}}',
      });
      mockEmailProvider.sendTemplatedEmail.mockResolvedValue({ messageId: 'msg-templated-custom-123' });

      const request = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        templateName: 'WelcomeTemplate',
        contactListName: 'custom-contact-list',
        topicName: 'custom-topic',
      };

      const result = await emailService.sendAdhocEmail(request);

      expect(result.messageId).toBe('msg-templated-custom-123');
      expect(mockEmailProvider.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'WelcomeTemplate',
          contactListName: 'custom-contact-list',
          topicName: 'custom-topic',
        }),
      );
    });
  });

  describe('sendBulkEmail', () => {
    it('should skip sending if email is already marked as SENT in recipient tracking table', async () => {
      mockCampaignRepo.getRecipientTracking.mockResolvedValue({
        campaignId: 'camp-123',
        emailAddress: 'already@example.com',
        batchId: 'batch-1',
        status: 'SENT',
        attempts: 1,
      });

      const message = {
        batchId: 'batch-1',
        campaignId: 'camp-123',
        recipientTrackingTable: 'RecipientTracking',
        batchTrackingTable: 'CampaignBatches',
        recipient: { email: 'already@example.com' },
        sender: { email: 's@e.com' },
        template: { name: 't' },
        attempts: 0,
        messageId: 'sqs-msg-1',
      };

      await emailService.sendBulkEmail(message);

      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockEmailProvider.sendTemplatedEmail).not.toHaveBeenCalled();
    });

    it('should load template from S3, replace placeholders, download attachments and send simple email', async () => {
      mockCampaignRepo.getRecipientTracking.mockResolvedValue(null);
      mockStorage.getObject.mockResolvedValue({
        body: JSON.stringify({
          subject: 'Welcome {{firstName}}',
          htmlContent:
            '<h1>Hello {{firstName}} {{lastName}}</h1><img src="data:image/png;base64,iVBORw0KGgo=" />',
        }),
      });
      mockStorage.getObjectAsBuffer.mockResolvedValue(Buffer.from('PDF_CONTENT'));
      mockEmailProvider.sendEmail.mockResolvedValue({ messageId: 'msg-bulk-1' });

      const message = {
        batchId: 'batch-1',
        campaignId: 'camp-123',
        recipientTrackingTable: 'RecipientTracking',
        batchTrackingTable: 'CampaignBatches',
        recipient: {
          email: 'john@example.com',
          metadata: { firstName: 'John', lastName: 'Doe' },
        },
        sender: { email: 'sender@example.com', name: 'Sender Name' },
        template: { name: 't' },
        attachments: [
          { filename: 'invoice.pdf', s3Key: 'invoice-key', contentType: 'application/pdf' },
        ],
        templateS3Key: 'templates/camp-123/template.json',
        attempts: 0,
        messageId: 'sqs-msg-2',
      };

      await emailService.sendBulkEmail(message);

      // Verify S3 template loading
      expect(mockStorage.getObject).toHaveBeenCalledWith(
        expect.any(String),
        'templates/camp-123/template.json',
      );

      // Verify S3 attachment download
      expect(mockStorage.getObjectAsBuffer).toHaveBeenCalledWith(expect.any(String), 'invoice-key');

      // Verify email send with replaced placeholders and attachments
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith({
        fromEmail: 'sender@example.com',
        fromName: 'Sender Name',
        toAddresses: ['john@example.com'],
        subject: 'Welcome John',
        htmlBody: '<h1>Hello John Doe</h1><img src="cid:mock-cid" />', // Regexp replace matches
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: 'invoice.pdf', contentType: 'application/pdf' }),
          expect.objectContaining({ contentDisposition: 'INLINE', contentType: 'image/png' }),
        ]),
        contactListName: null,
        topicName: '',
      });
      expect(mockEmailProvider.sendEmail.mock.calls[0][0]).not.toHaveProperty(
        'configurationSetName',
      );

      // Verify recipient tracking and batch count increments in database
      expect(mockCampaignRepo.createOrUpdateRecipientTracking).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: 'camp-123',
          emailAddress: 'john@example.com',
          status: 'SENT',
          messageId: 'msg-bulk-1',
        }),
      );
      expect(mockCampaignRepo.incrementBatchCounts).toHaveBeenCalledWith({
        campaignId: 'camp-123',
        batchId: 'batch-1',
        sentIncrement: 1,
        failedIncrement: 0,
      });
    });

    it('should use SES template registry when templateS3Key is missing', async () => {
      mockCampaignRepo.getRecipientTracking.mockResolvedValue(null);
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'temp-reg',
        subject: 'Subject',
        htmlContent: '{{amazonSESUnsubscribeUrl}}',
      });
      mockEmailProvider.sendTemplatedEmail.mockResolvedValue({ messageId: 'msg-bulk-2' });

      const message = {
        batchId: 'batch-1',
        campaignId: 'camp-123',
        recipientTrackingTable: 'RecipientTracking',
        batchTrackingTable: 'CampaignBatches',
        recipient: {
          email: 'jane@example.com',
          metadata: { firstName: 'Jane' },
        },
        sender: { email: 'sender@example.com' },
        template: { name: 'temp-reg' },
        attempts: 0,
        messageId: 'sqs-msg-3',
      };

      await emailService.sendBulkEmail(message);

      expect(mockTemplateRegistry.getTemplate).toHaveBeenCalledWith('temp-reg');

      expect(mockEmailProvider.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'temp-reg',
          templateData: { firstName: 'Jane', lastName: '' },
          unsubscribePlaceholderFound: true,
        }),
      );
      expect(mockEmailProvider.sendTemplatedEmail.mock.calls[0][0]).not.toHaveProperty(
        'configurationSetName',
      );
    });

    it('should record failure and throw error when email send fails', async () => {
      mockCampaignRepo.getRecipientTracking.mockResolvedValue(null);
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'temp-reg',
        subject: 'Subject',
      });
      mockEmailProvider.sendTemplatedEmail.mockRejectedValue(new Error('SES Limit Exceeded'));

      const message = {
        batchId: 'batch-1',
        campaignId: 'camp-123',
        recipientTrackingTable: 'RecipientTracking',
        batchTrackingTable: 'CampaignBatches',
        recipient: { email: 'fail@example.com' },
        sender: { email: 'sender@example.com' },
        template: { name: 'temp-reg' },
        attempts: 0,
        messageId: 'sqs-msg-4',
      };

      await expect(emailService.sendBulkEmail(message)).rejects.toThrow('SES Limit Exceeded');

      // Check DB logs
      expect(mockCampaignRepo.createOrUpdateRecipientTracking).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'SES Limit Exceeded',
        }),
      );
      expect(mockCampaignRepo.incrementBatchCounts).toHaveBeenCalledWith({
        campaignId: 'camp-123',
        batchId: 'batch-1',
        sentIncrement: 0,
        failedIncrement: 1,
      });
    });
  });

  describe('sendBookingConfirmedEmail', () => {
    beforeEach(() => {
      environment.defaultFromEmail = 'noreply@beautyonwheels.test';
      environment.defaultFromName = 'Beauty on Wheels';
      environment.bookingConfirmedTemplateName = 'BookingConfirmed';
    });

    it('resolves the SES template from the booking event type', async () => {
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'BookingConfirmed',
        subject: 'Booking confirmed',
        htmlContent: '<p>Thanks {{customerName}}</p>',
        textContent: 'Thanks',
      });
      mockEmailProvider.sendTemplatedEmail.mockResolvedValue({
        messageId: 'ses-booking-1',
      });

      const result = await emailService.sendBookingConfirmedEmail({
        bookingId: 'bkg-1',
        customerId: 'cust-1',
        vendorId: 'vendor-1',
        customerEmail: 'customer@example.com',
        bookingDate: '2026-09-20',
        slotId: 'slot-1',
        bookingStatus: 'confirmed',
        totalAmount: 149.5,
        customerName: 'Ada',
        vendorName: 'ABC Car Wash',
      });

      expect(result.messageId).toBe('ses-booking-1');
      expect(mockEmailProvider.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          fromEmail: 'noreply@beautyonwheels.test',
          toAddresses: ['customer@example.com'],
          templateName: 'BookingConfirmed',
          templateData: {
            bookingId: 'bkg-1',
            vendorId: 'vendor-1',
            bookingDate: '2026-09-20',
            slotId: 'slot-1',
            totalAmount: 149.5,
            customerName: 'Ada',
            vendorName: 'ABC Car Wash',
          },
        }),
      );
    });
  });

  describe('sendVendorEmailVerificationRequestedEmail', () => {
    beforeEach(() => {
      environment.defaultFromEmail = 'noreply@beautyonwheels.test';
      environment.defaultFromName = 'Beauty on Wheels';
      environment.vendorEmailConfirmationTemplateName = 'VENDOR_EMAIL_VERIFICATION';
    });

    it('maps the event to the existing /send-email contract', async () => {
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'VENDOR_EMAIL_VERIFICATION',
        subject: 'Confirm your email',
        htmlContent: '<p>Hello {{ownerName}}</p>',
        textContent: 'Hello',
      });
      mockEmailProvider.sendTemplatedEmail.mockResolvedValue({
        messageId: 'ses-verify-1',
      });

      const result = await emailService.sendVendorEmailVerificationRequestedEmail({
        vendorId: 'vendor-1',
        verificationRequestId: 'verify-1',
        ownerUserId: 'user-1',
        email: 'owner@example.com',
        ownerName: 'Priya', businessName: 'ABC Car Wash', verificationUrl: 'https://app.test/verify?token=opaque',
        vendorStatus: 'PENDING_VERIFICATION',
        applicationId: 'app-1',
      });

      expect(result.messageId).toBe('ses-verify-1');
      expect(mockEmailProvider.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          fromEmail: 'noreply@beautyonwheels.test',
          toAddresses: ['owner@example.com'],
          templateName: 'VENDOR_EMAIL_VERIFICATION',
          templateData: {
            ownerName: 'Priya', businessName: 'ABC Car Wash', verificationUrl: 'https://app.test/verify?token=opaque',
          },
        }),
      );
    });

    it('propagates provider failures', async () => {
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'VENDOR_EMAIL_VERIFICATION',
        subject: 'Confirm your email',
        htmlContent: '<p>Hello</p>',
        textContent: 'Hello',
      });
      mockEmailProvider.sendTemplatedEmail.mockRejectedValue(
        new Error('SES unavailable'),
      );

      await expect(
        emailService.sendVendorEmailVerificationRequestedEmail({
          vendorId: 'vendor-1',
          verificationRequestId: 'verify-1',
          ownerUserId: 'user-1',
          email: 'owner@example.com',
          ownerName: 'Priya', businessName: 'ABC Car Wash', verificationUrl: 'https://app.test/verify?token=opaque',
          vendorStatus: 'PENDING_VERIFICATION',
        }),
      ).rejects.toThrow('SES unavailable');
    });
  });

  describe('sendVendorOnboardingSubmittedEmail', () => {
    beforeEach(() => {
      environment.defaultFromEmail = 'noreply@beautyonwheels.test';
      environment.defaultFromName = 'Beauty on Wheels';
      environment.vendorOnboardingTemplateName = 'VendorOnboardingSubmitted';
    });

    it('resolves the SES template and sends via the email provider', async () => {
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'VendorOnboardingSubmitted',
        subject: 'Application received',
        htmlContent: '<p>Thanks {{businessName}}</p>',
        textContent: 'Thanks',
      });
      mockEmailProvider.sendTemplatedEmail.mockResolvedValue({
        messageId: 'ses-onboard-1',
      });

      const result = await emailService.sendVendorOnboardingSubmittedEmail({
        applicationId: 'app-1',
        vendorId: 'vendor-1',
        ownerUserId: 'user-1',
        email: 'owner@example.com',
        onboardingStatus: 'PENDING_REVIEW',
        businessName: 'ABC Car Wash',
      });

      expect(result.messageId).toBe('ses-onboard-1');
      expect(mockEmailProvider.sendTemplatedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          fromEmail: 'noreply@beautyonwheels.test',
          toAddresses: ['owner@example.com'],
          templateName: 'VendorOnboardingSubmitted',
          templateData: {
            applicationId: 'app-1',
            vendorId: 'vendor-1',
            businessName: 'ABC Car Wash',
          },
        }),
      );
    });

    it('propagates provider failures', async () => {
      mockTemplateRegistry.getTemplate.mockResolvedValue({
        templateName: 'VendorOnboardingSubmitted',
        subject: 'Application received',
        htmlContent: '<p>Thanks</p>',
        textContent: 'Thanks',
      });
      mockEmailProvider.sendTemplatedEmail.mockRejectedValue(
        new Error('SES unavailable'),
      );

      await expect(
        emailService.sendVendorOnboardingSubmittedEmail({
          applicationId: 'app-1',
          vendorId: 'vendor-1',
          ownerUserId: 'user-1',
          email: 'owner@example.com',
          onboardingStatus: 'PENDING_REVIEW',
        }),
      ).rejects.toThrow('SES unavailable');
    });
  });
});

// Mock crypto.randomUUID to make snapshot matchings stable
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => 'mock-cid',
}));
