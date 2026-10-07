import { createChildLogger, createLogger } from '@api-hub/observability';
import { ChannelError, CHANNEL_ERROR_CODE, isChannelError, maskPhone } from '../errors/channel-error';
import { MetaWhatsAppProvider } from '../providers/meta-whatsapp.provider';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'whatsapp-message',
});

const E164 = /^\+?[1-9]\d{7,14}$/;
const MAX_TEXT_LENGTH = 4096;

export interface SendTextCommand {
  to?: unknown;
  message?: unknown;
}

export interface SendTextResult {
  messageId: string;
  to: string;
}

export function normalizeWhatsAppRecipient(value: string): string | null {
  const trimmed = value.trim();
  if (!E164.test(trimmed)) return null;
  return trimmed.replace(/^\+/, '');
}

export class WhatsAppMessageService {
  constructor(private readonly meta: Pick<MetaWhatsAppProvider, 'sendText'>) {}

  async sendText(command: SendTextCommand): Promise<SendTextResult> {
    const to = this.recipient(command.to);
    const message = this.body(command.message);
    logger.info({ event: 'whatsapp_send_attempted', to: maskPhone(to) });
    try {
      const result = await this.meta.sendText(to, message);
      return { messageId: result.messageId, to };
    } catch (error) {
      logger.error({
        event: 'whatsapp_send_failed',
        to: maskPhone(to),
        code: isChannelError(error) ? error.code : CHANNEL_ERROR_CODE.INTERNAL_ERROR,
      });
      throw error;
    }
  }

  private recipient(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Recipient phone number is required', {
        metadata: { field: 'to' },
      });
    }
    const to = normalizeWhatsAppRecipient(value);
    if (!to) {
      throw new ChannelError(
        CHANNEL_ERROR_CODE.VALIDATION_ERROR,
        'Recipient must be a WhatsApp phone number in E.164 format',
        { metadata: { field: 'to' } },
      );
    }
    return to;
  }

  private body(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Message text is required', {
        metadata: { field: 'message' },
      });
    }
    const message = value.trim();
    if (message.length > MAX_TEXT_LENGTH) {
      throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Message text must be 4096 characters or fewer', {
        metadata: { field: 'message' },
      });
    }
    return message;
  }
}
