import { SesEmailProvider } from '../../../common/providers/impl/SesEmailProvider.js';
import { environment } from '../../../common/config/environment.js';
import { logger } from '../../../common/utils/logger.js';

jest.mock('@aws-sdk/client-sesv2', () => {
  const mSend = jest.fn();
  return {
    SESv2Client: jest.fn().mockImplementation(() => {
      return {
        send: mSend,
      };
    }),
    SendEmailCommand: jest.fn().mockImplementation((params) => {
      return { input: params, type: 'SendEmailCommand' };
    }),
    ListEmailIdentitiesCommand: jest.fn().mockImplementation((params) => {
      return { input: params, type: 'ListEmailIdentitiesCommand' };
    }),
    GetEmailIdentityCommand: jest.fn().mockImplementation((params) => {
      return { input: params, type: 'GetEmailIdentityCommand' };
    }),
    GetContactListCommand: jest.fn().mockImplementation((params) => {
      return { input: params, type: 'GetContactListCommand' };
    }),
  };
});

describe('SesEmailProvider', () => {
  let provider: SesEmailProvider;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new SesEmailProvider('us-east-1');
    mockSend = (provider as any).client.send;
  });

  describe('constructor / offline configuration', () => {
    it('should initialize with local endpoint when offline is true', () => {
      const originalOffline = environment.isOffline;
      const originalSesEndpoint = environment.sesEndpoint;
      
      environment.isOffline = true;
      environment.sesEndpoint = 'http://localhost:1234';

      const localProvider = new SesEmailProvider('us-east-1');
      expect(localProvider).toBeDefined();

      environment.isOffline = originalOffline;
      environment.sesEndpoint = originalSesEndpoint;
    });
  });

  describe('sendEmail', () => {
    it('should successfully send a raw email with cc, bcc, and replyTo', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'msg-raw-123',
        $metadata: {
          httpStatusCode: 200,
          requestId: 'req-raw-123',
          attempts: 1,
        },
      });

      const options = {
        fromEmail: 'sender@example.com',
        fromName: 'Sender Name',
        toAddresses: ['receiver@example.com'],
        ccAddresses: ['cc@example.com'],
        bccAddresses: ['bcc@example.com'],
        replyToAddresses: ['reply@example.com'],
        subject: 'Hello Raw',
        htmlBody: '<p>Hello</p>',
        textBody: 'Hello',
        attachments: [
          {
            filename: 'test.txt',
            contentType: 'text/plain',
            rawContent: Buffer.from('content'),
          },
        ],
        contactListName: 'my-list',
        topicName: 'my-topic',
      };

      const result = await provider.sendEmail(options);

      expect(result.messageId).toBe('msg-raw-123');
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Verify parameters
      const commandCall = mockSend.mock.calls[0][0];
      expect(commandCall.input).toEqual({
        FromEmailAddress: 'Sender Name <sender@example.com>',
        Destination: {
          ToAddresses: ['receiver@example.com'],
          CcAddresses: ['cc@example.com'],
          BccAddresses: ['bcc@example.com'],
        },
        ReplyToAddresses: ['reply@example.com'],
        Content: {
          Simple: {
            Subject: {
              Data: 'Hello Raw',
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: '<p>Hello</p>',
                Charset: 'UTF-8',
              },
              Text: {
                Data: 'Hello',
                Charset: 'UTF-8',
              },
            },
            Attachments: [
              {
                FileName: 'test.txt',
                ContentType: 'text/plain',
                RawContent: expect.any(Buffer),
                ContentDisposition: 'ATTACHMENT',
                ContentTransferEncoding: 'BASE64',
              },
            ],
          },
        },
        ListManagementOptions: {
          ContactListName: 'my-list',
          TopicName: 'my-topic',
        },
      });
    });

    it('should retry sending raw email without ListManagementOptions if contact list is missing', async () => {
      const notFoundError: any = new Error('List with name my-list doesn\'t exist');
      notFoundError.name = 'NotFoundException';
      notFoundError.$metadata = {
        httpStatusCode: 404,
        requestId: 'req-error-123',
        attempts: 1,
      };

      mockSend
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({
          MessageId: 'msg-raw-retry-123',
          $metadata: {
            httpStatusCode: 200,
            requestId: 'req-success-123',
            attempts: 1,
          },
        });

      const options = {
        fromEmail: 'sender@example.com',
        toAddresses: ['receiver@example.com'],
        subject: 'Hello Raw Retry',
        htmlBody: '<p>Hello {{amazonSESUnsubscribeUrl}}</p>',
        contactListName: 'my-list',
      };

      const result = await provider.sendEmail(options);

      expect(result.messageId).toBe('msg-raw-retry-123');
      expect(mockSend).toHaveBeenCalledTimes(2);

      // Verify first call had ListManagementOptions
      const firstCall = mockSend.mock.calls[0][0];
      expect(firstCall.input.ListManagementOptions).toEqual({
        ContactListName: 'my-list',
      });

      // Verify second call had NO ListManagementOptions and unsubscribe placeholder was replaced
      const secondCall = mockSend.mock.calls[1][0];
      expect(secondCall.input.ListManagementOptions).toBeUndefined();
      expect(secondCall.input.Content.Simple.Body.Html.Data).toBe('<p>Hello #</p>');
    });

    it('should propagate other SES exceptions when sending raw email', async () => {
      const limitExceededError = new Error('Limit Exceeded');
      limitExceededError.name = 'LimitExceededException';

      mockSend.mockRejectedValueOnce(limitExceededError);

      const options = {
        fromEmail: 'sender@example.com',
        toAddresses: ['receiver@example.com'],
        subject: 'Hello Error',
        htmlBody: 'Hello',
      };

      await expect(provider.sendEmail(options)).rejects.toThrow('Limit Exceeded');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendTemplatedEmail', () => {
    it('should successfully send a templated email with cc, bcc, reply-to, and attachments', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'msg-template-123',
        $metadata: {
          httpStatusCode: 200,
          requestId: 'req-template-123',
          attempts: 1,
        },
      });

      const options = {
        fromEmail: 'sender@example.com',
        toAddresses: ['receiver@example.com'],
        ccAddresses: ['cc@example.com'],
        bccAddresses: ['bcc@example.com'],
        replyToAddresses: ['reply@example.com'],
        templateName: 'simple-test',
        templateData: { firstName: 'Prasanth' },
        contactListName: 'my-list',
        unsubscribePlaceholderFound: true,
        attachments: [
          {
            filename: 'test.pdf',
            contentType: 'application/pdf',
            rawContent: Buffer.from('pdf content'),
          },
        ],
      };

      const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined as never);
      const result = await provider.sendTemplatedEmail({
        ...options,
        toAddresses: ['receiver@example.com', 'other@example.com'],
        configurationSetName: 'test-email-delivery',
      });

      expect(result.messageId).toBe('msg-template-123');
      expect(info).toHaveBeenCalledWith('Sending templated email via SES', {
        templateName: 'simple-test',
        toCount: 2,
        configurationSetName: 'test-email-delivery',
      });
      const success = info.mock.calls.find((call) => call[0] === 'SES Templated Email Success');
      expect(success?.[1]).toEqual(expect.objectContaining({ attempts: 1 }));
      expect(success?.[1]).not.toHaveProperty('retryAttempts');
      info.mockRestore();
      expect(mockSend).toHaveBeenCalledTimes(1);

      const call = mockSend.mock.calls[0][0];
      expect(call.input).toEqual({
        FromEmailAddress: 'sender@example.com',
        Destination: {
          ToAddresses: ['receiver@example.com', 'other@example.com'],
          CcAddresses: ['cc@example.com'],
          BccAddresses: ['bcc@example.com'],
        },
        ConfigurationSetName: 'test-email-delivery',
        ReplyToAddresses: ['reply@example.com'],
        Content: {
          Template: {
            TemplateName: 'simple-test',
            TemplateData: JSON.stringify({ firstName: 'Prasanth' }),
            Attachments: [
              {
                FileName: 'test.pdf',
                ContentType: 'application/pdf',
                RawContent: expect.any(Buffer),
                ContentDisposition: 'ATTACHMENT',
                ContentTransferEncoding: 'BASE64',
              },
            ],
          },
        },
        ListManagementOptions: {
          ContactListName: 'my-list',
        },
      });
    });

    it('should rethrow NotFoundException without retry if template has unsubscribe placeholder', async () => {
      const notFoundError: any = new Error('List with name my-list doesn\'t exist');
      notFoundError.name = 'NotFoundException';

      mockSend.mockRejectedValueOnce(notFoundError);

      const options = {
        fromEmail: 'sender@example.com',
        toAddresses: ['receiver@example.com'],
        templateName: 'simple-test',
        templateData: { firstName: 'Prasanth' },
        contactListName: 'my-list',
        unsubscribePlaceholderFound: true,
      };

      await expect(provider.sendTemplatedEmail(options)).rejects.toThrow('List with name my-list doesn\'t exist');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should retry sending templated email without ListManagementOptions if list is missing but unsubscribePlaceholderFound is false', async () => {
      const notFoundError: any = new Error('List with name my-list doesn\'t exist');
      notFoundError.name = 'NotFoundException';
      notFoundError.$metadata = {
        httpStatusCode: 404,
        requestId: 'req-error-123',
        attempts: 1,
      };

      mockSend
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({
          MessageId: 'msg-template-retry-123',
          $metadata: {
            httpStatusCode: 200,
            requestId: 'req-retry-123',
            attempts: 1,
          },
        });

      const options = {
        fromEmail: 'sender@example.com',
        toAddresses: ['receiver@example.com'],
        templateName: 'simple-test',
        templateData: { firstName: 'Prasanth' },
        contactListName: 'my-list',
        unsubscribePlaceholderFound: false,
      };

      const result = await provider.sendTemplatedEmail(options);
      expect(result.messageId).toBe('msg-template-retry-123');
      expect(mockSend).toHaveBeenCalledTimes(2);

      // First call should have ListManagementOptions since contactListName is provided
      const firstCall = mockSend.mock.calls[0][0];
      expect(firstCall.input.ListManagementOptions).toEqual({
        ContactListName: 'my-list',
      });

      // Second call should NOT have ListManagementOptions
      const secondCall = mockSend.mock.calls[1][0];
      expect(secondCall.input.ListManagementOptions).toBeUndefined();
    });
  });

  describe('listVerifiedEmails', () => {
    it('should list verified emails successfully', async () => {
      mockSend
        .mockResolvedValueOnce({
          EmailIdentities: [
            { IdentityType: 'EMAIL_ADDRESS', IdentityName: 'test1@example.com' },
            { IdentityType: 'DOMAIN', IdentityName: 'example.com' },
            { IdentityType: 'EMAIL_ADDRESS', IdentityName: 'test2@example.com' },
          ],
          NextToken: 'token-1',
        })
        .mockResolvedValueOnce({
          VerifiedForSendingStatus: true,
        })
        .mockResolvedValueOnce({
          VerifiedForSendingStatus: false,
        })
        .mockResolvedValueOnce({
          EmailIdentities: [
            { IdentityType: 'EMAIL_ADDRESS', IdentityName: 'test3@example.com' },
          ],
          NextToken: undefined,
        })
        .mockResolvedValueOnce({
          VerifiedForSendingStatus: true,
        });

      const verified = await provider.listVerifiedEmails();

      expect(verified).toEqual(['test1@example.com', 'test3@example.com']);
      expect(mockSend).toHaveBeenCalledTimes(5);
    });

    it('should propagate errors from listVerifiedEmails', async () => {
      mockSend.mockRejectedValueOnce(new Error('SES identities error'));

      await expect(provider.listVerifiedEmails()).rejects.toThrow('SES identities error');
    });
  });

  describe('listTopics', () => {
    it('should retrieve list of topics successfully', async () => {
      mockSend.mockResolvedValueOnce({
        Topics: [
          { TopicName: 'TopicA', DisplayName: 'A', Description: 'Desc A', DefaultSubscriptionStatus: 'OPT_IN' },
          { TopicName: 'TopicB', DisplayName: 'B', Description: 'Desc B', DefaultSubscriptionStatus: 'OPT_OUT' },
        ],
      });

      const topics = await provider.listTopics('my-contact-list');

      expect(topics).toEqual([
        { TopicName: 'TopicA', DisplayName: 'A', Description: 'Desc A', DefaultSubscriptionStatus: 'OPT_IN' },
        { TopicName: 'TopicB', DisplayName: 'B', Description: 'Desc B', DefaultSubscriptionStatus: 'OPT_OUT' },
      ]);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from listTopics', async () => {
      mockSend.mockRejectedValueOnce(new Error('SES contact list error'));

      await expect(provider.listTopics('my-contact-list')).rejects.toThrow('SES contact list error');
    });
  });
});
