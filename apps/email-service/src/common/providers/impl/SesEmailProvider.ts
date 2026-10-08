import {
  SESv2Client,
  SendEmailCommand,
  ListEmailIdentitiesCommand,
  GetEmailIdentityCommand,
  GetContactListCommand,
  SendEmailRequest,
} from '@aws-sdk/client-sesv2';
import {
  IEmailProvider,
  SendEmailOptions,
  SendTemplatedEmailOptions,
  TopicMetadata,
} from '../IEmailProvider.js';
import { logger } from '../../utils/logger.js';

import { environment } from '../../config/environment.js';

export class SesEmailProvider implements IEmailProvider {
  private client: SESv2Client;

  constructor(region: string) {
    const config: any = { region };
    if (environment.isOffline) {
      config.endpoint = environment.sesEndpoint;
      config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
    }
    this.client = new SESv2Client(config);
  }
  async sendEmail(options: SendEmailOptions): Promise<{ messageId: string }> {
    const destination: any = {
      ToAddresses: options.toAddresses,
    };
    if (options.ccAddresses && options.ccAddresses.length > 0) {
      destination.CcAddresses = options.ccAddresses;
    }
    if (options.bccAddresses && options.bccAddresses.length > 0) {
      destination.BccAddresses = options.bccAddresses;
    }

    const emailParams: SendEmailRequest = {
      FromEmailAddress: options.fromName
        ? `${options.fromName} <${options.fromEmail}>`
        : options.fromEmail,
      Destination: destination,
      Content: {
        Simple: {
          Subject: {
            Data: options.subject,
            Charset: 'UTF-8',
          },
          Body: {},
        },
      },
    };

    if (options.replyToAddresses && options.replyToAddresses.length > 0) {
      emailParams.ReplyToAddresses = options.replyToAddresses;
    }

    if (options.configurationSetName) {
      emailParams.ConfigurationSetName = options.configurationSetName;
    }
    if (options.emailTags && options.emailTags.length > 0) {
      emailParams.EmailTags = options.emailTags.map((tag) => ({
        Name: tag.name,
        Value: tag.value,
      }));
    }

    if (options.htmlBody) {
      emailParams.Content!.Simple!.Body!.Html = {
        Data: options.htmlBody,
        Charset: 'UTF-8',
      };
    }

    if (options.textBody) {
      emailParams.Content!.Simple!.Body!.Text = {
        Data: options.textBody,
        Charset: 'UTF-8',
      };
    }

    // Attachments
    if (options.attachments && options.attachments.length > 0) {
      emailParams.Content!.Simple!.Attachments = options.attachments.map(att => ({
        FileName: att.filename,
        ContentType: att.contentType,
        RawContent: att.rawContent,
        ContentDisposition: att.contentDisposition || 'ATTACHMENT',
        ContentTransferEncoding: 'BASE64',
        ...(att.contentId ? { ContentId: att.contentId } : {}),
      }));
    }

    // List Management / Unsubscribe
    if (options.contactListName) {
      emailParams.ListManagementOptions = {
        ContactListName: options.contactListName,
        ...(options.topicName && options.topicName !== 'NONE'
          ? { TopicName: options.topicName }
          : {}),
      };
    }

    try {
      logger.info('Sending simple email via SES', {
        toCount: options.toAddresses.length,
        hasHtml: Boolean(options.htmlBody),
        hasText: Boolean(options.textBody),
        configurationSetName: options.configurationSetName,
      });
      const command = new SendEmailCommand(emailParams);
      const response = await this.client.send(command);
      logger.info('SES Simple Email Success', {
        messageId: response.MessageId,
        requestId: response.$metadata?.requestId,
        httpStatusCode: response.$metadata?.httpStatusCode,
        attempts: response.$metadata?.attempts,
        sdkMetadata: response.$metadata,
      });
      return { messageId: response.MessageId || '' };
    } catch (error: any) {
      // If the error is due to a missing SES contact list, retry without list management options
      if (
        error.name === 'NotFoundException' &&
        error.message?.includes('List with name') &&
        emailParams.ListManagementOptions
      ) {
        logger.warn(
          `Contact list ${options.contactListName} does not exist. Retrying simple send without ListManagementOptions.`,
          {
            error: error.message,
            requestId: error.$metadata?.requestId,
            httpStatusCode: error.$metadata?.httpStatusCode,
            attempts: error.$metadata?.attempts,
          },
        );

        const retryParams = {
          ...emailParams,
          Content: {
            ...emailParams.Content,
            Simple: emailParams.Content?.Simple
              ? {
                  ...emailParams.Content.Simple,
                  Body: {
                    ...emailParams.Content.Simple.Body,
                    Html: emailParams.Content.Simple.Body?.Html
                      ? {
                          ...emailParams.Content.Simple.Body.Html,
                          Data: emailParams.Content.Simple.Body.Html.Data?.replace(
                            /{{amazonSESUnsubscribeUrl}}/g,
                            '#',
                          ),
                        }
                      : undefined,
                    Text: emailParams.Content.Simple.Body?.Text
                      ? {
                          ...emailParams.Content.Simple.Body.Text,
                          Data: emailParams.Content.Simple.Body.Text.Data?.replace(
                            /{{amazonSESUnsubscribeUrl}}/g,
                            '',
                          ),
                        }
                      : undefined,
                  },
                }
              : undefined,
          },
        };
        delete retryParams.ListManagementOptions;

        logger.info('Retrying SES simple email without list management');

        const command = new SendEmailCommand(retryParams);
        const response = await this.client.send(command);
        logger.info('SES  Email Retry Success', {
          messageId: response.MessageId,
          requestId: response.$metadata?.requestId,
          httpStatusCode: response.$metadata?.httpStatusCode,
          attempts: response.$metadata?.attempts,
          sdkMetadata: response.$metadata,
        });

        return { messageId: response.MessageId || '' };
      }

      logger.error('Error sending simple email via SES', {
        errorName: error?.name,
        requestId: error.$metadata?.requestId,
        httpStatusCode: error.$metadata?.httpStatusCode,
        attempts: error.$metadata?.attempts,
      });
      throw error;
    }
  }

  async sendTemplatedEmail(options: SendTemplatedEmailOptions): Promise<{ messageId: string }> {
    const destination: any = {
      ToAddresses: options.toAddresses,
    };
    if (options.ccAddresses && options.ccAddresses.length > 0) {
      destination.CcAddresses = options.ccAddresses;
    }
    if (options.bccAddresses && options.bccAddresses.length > 0) {
      destination.BccAddresses = options.bccAddresses;
    }

    const emailParams: SendEmailRequest = {
      FromEmailAddress: options.fromName
        ? `${options.fromName} <${options.fromEmail}>`
        : options.fromEmail,
      Destination: destination,
      Content: {
        Template: {
          TemplateName: options.templateName,
          TemplateData: JSON.stringify(options.templateData),
        },
      },
    };

    if (options.replyToAddresses && options.replyToAddresses.length > 0) {
      emailParams.ReplyToAddresses = options.replyToAddresses;
    }
    if (options.configurationSetName) {
      emailParams.ConfigurationSetName = options.configurationSetName;
    }

    // Attachments
    if (options.attachments && options.attachments.length > 0) {
      emailParams.Content!.Template!.Attachments = options.attachments.map(att => ({
        FileName: att.filename,
        ContentType: att.contentType,
        RawContent: att.rawContent,
        ContentDisposition: att.contentDisposition || 'ATTACHMENT',
        ContentTransferEncoding: 'BASE64',
        ...(att.contentId ? { ContentId: att.contentId } : {}),
      }));
    }

    // List Management / Unsubscribe
    if (options.contactListName) {
      emailParams.ListManagementOptions = {
        ContactListName: options.contactListName,
        ...(options.topicName && options.topicName !== 'NONE'
          ? { TopicName: options.topicName }
          : {}),
      };
    }

    try {
      logger.info('Sending templated email via SES', {
        templateName: options.templateName,
        toCount: options.toAddresses.length,
        configurationSetName: options.configurationSetName,
      });
      const command = new SendEmailCommand(emailParams);
      const response = await this.client.send(command);
      logger.info('SES Templated Email Success', {
        messageId: response.MessageId,
        requestId: response.$metadata?.requestId,
        httpStatusCode: response.$metadata?.httpStatusCode,
        attempts: response.$metadata?.attempts,
        sdkMetadata: response.$metadata,
      });
      return { messageId: response.MessageId || '' };
    } catch (error: any) {
      if (
        error.name === 'NotFoundException' &&
        error.message?.includes('List with name') &&
        emailParams.ListManagementOptions
      ) {
        if (options.unsubscribePlaceholderFound) {
          logger.error(
            `Contact list ${options.contactListName} does not exist. Rethrowing error because template contains an unsubscribe placeholder that cannot be rendered without it.`,
            { error: error.message, options },
          );
          throw error;
        }

        logger.warn(
          `Contact list ${options.contactListName} does not exist. Retrying templated send without ListManagementOptions because template does not have unsubscribe placeholder.`,
          {
            error: error.message,
            requestId: error.$metadata?.requestId,
            httpStatusCode: error.$metadata?.httpStatusCode,
            attempts: error.$metadata?.attempts,
          },
        );

        const retryParams = { ...emailParams };
        delete retryParams.ListManagementOptions;

        logger.info('Retrying SES templated email without list management', {
          templateName: options.templateName,
        });

        const command = new SendEmailCommand(retryParams);
        const response = await this.client.send(command);

        logger.info('SES Templated Email Retry Success', {
          messageId: response.MessageId,
          requestId: response.$metadata?.requestId,
          httpStatusCode: response.$metadata?.httpStatusCode,
          attempts: response.$metadata?.attempts,
          sdkMetadata: response.$metadata,
        });

        return { messageId: response.MessageId || '' };
      }

      logger.error('Error sending templated email via SES', {
        errorName: error?.name,
        templateName: options.templateName,
        requestId: error.$metadata?.requestId,
        httpStatusCode: error.$metadata?.httpStatusCode,
        attempts: error.$metadata?.attempts,
      });
      throw error;
    }
  }

  async listVerifiedEmails(): Promise<string[]> {
    const verifiedEmails: string[] = [];
    let nextToken: string | undefined;

    try {
      do {
        const listCommand: ListEmailIdentitiesCommand = new ListEmailIdentitiesCommand({
          NextToken: nextToken,
        });
        const listResponse = await this.client.send(listCommand);

        const identities = listResponse.EmailIdentities || [];
        for (const identity of identities) {
          if (identity.IdentityType === 'EMAIL_ADDRESS') {
            const getCommand = new GetEmailIdentityCommand({
              EmailIdentity: identity.IdentityName,
            });
            const info = await this.client.send(getCommand);
            if (info.VerifiedForSendingStatus) {
              verifiedEmails.push(identity.IdentityName || '');
            }
          }
        }

        nextToken = listResponse.NextToken;
      } while (nextToken);

      return verifiedEmails;
    } catch (error) {
      logger.error('Error listing verified email identities', { error });
      throw error;
    }
  }

  async listTopics(contactListName: string): Promise<TopicMetadata[]> {
    try {
      const command = new GetContactListCommand({
        ContactListName: contactListName,
      });
      const response = await this.client.send(command);

      return (response.Topics || []).map(topic => ({
        TopicName: topic.TopicName || '',
        DisplayName: topic.DisplayName,
        Description: topic.Description,
        DefaultSubscriptionStatus: topic.DefaultSubscriptionStatus || 'OPT_IN',
      }));
    } catch (error: any) {
      logger.error('Error fetching contact list topics', { error, contactListName });
      throw error;
    }
  }
}
