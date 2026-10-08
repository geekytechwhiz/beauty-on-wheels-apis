import type { IEmailProvider } from '../../../common/providers/IEmailProvider.js';
import type { RenderedEmail } from '../templates/template-renderer.js';
import { SesRetryableError } from '../domain/errors.js';
import { classifySesError, sesTagValue } from './classify-ses-error.js';

export type OutboundEmail = {
  fromEmail: string;
  fromName?: string;
  replyTo?: string[];
  to: string[];
  cc?: string[];
  bcc?: string[];
  rendered: RenderedEmail;
  configurationSetName?: string;
  eventId: string;
  idempotencyKey: string;
  templateName: string;
};

export class SesEmailSender {
  constructor(private readonly provider: IEmailProvider) {}

  async dispatch(email: OutboundEmail): Promise<{ messageId: string }> {
    try {
      const result = await this.provider.sendEmail({
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        toAddresses: email.to,
        ccAddresses: email.cc,
        bccAddresses: email.bcc,
        replyToAddresses: email.replyTo,
        subject: email.rendered.subject,
        htmlBody: email.rendered.htmlBody,
        textBody: email.rendered.textBody,
        configurationSetName: email.configurationSetName,
        emailTags: [
          { name: 'eventId', value: sesTagValue(email.eventId) },
          { name: 'templateName', value: sesTagValue(email.templateName) },
          { name: 'idempotencyKey', value: sesTagValue(email.idempotencyKey) },
        ],
      });
      if (!result.messageId) {
        throw new SesRetryableError('SES did not return a message id', {
          code: 'SES_MESSAGE_ID_MISSING',
        });
      }
      return { messageId: result.messageId };
    } catch (error) {
      if (error instanceof SesRetryableError) {
        throw error;
      }
      throw classifySesError(error);
    }
  }
}
