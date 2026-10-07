import { createChildLogger, createLogger, withContext } from '@api-hub/observability';
import { maskPhone } from '../errors/channel-error';
import { ConversationFlow } from '../flows/conversation.flow';
import { ConversationStore } from '../repositories/conversation.repository';
import { recordMetric, WHATSAPP_METRIC } from '../infra/metrics';
import { MetaWhatsAppProvider } from '../providers/meta-whatsapp.provider';
import { CustomerChannelService } from './customer-channel.service';
import { WhatsAppWebhookPayload } from '../types/whatsapp';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'channel-service',
});

export class WhatsAppChannelService {
  constructor(
    private readonly store: ConversationStore,
    private readonly meta: MetaWhatsAppProvider,
    private readonly flow: ConversationFlow,
    private readonly customers: CustomerChannelService,
  ) {}

  async processWebhook(payload: WhatsAppWebhookPayload, correlationId: string): Promise<void> {
    await withContext({ correlationId }, async () => {
      for (const status of this.meta.parseStatuses(payload)) {
        logger.info({ event: 'whatsapp_status', status: status.status, whatsappMessageId: status.messageId, correlationId });
      }

      const messages = this.meta.parseMessages(payload);
      for (const message of messages) {
        recordMetric(WHATSAPP_METRIC.MESSAGES_RECEIVED);
        const claimed = await this.store.claimEvent(message.messageId, message.messageId);
        if (!claimed) {
          logger.info({ event: 'duplicate_webhook', whatsappMessageId: message.messageId, correlationId });
          continue;
        }
        try {
          await withContext({ correlationId, whatsappMessageId: message.messageId }, async () => {
            await this.meta.markRead(message.messageId).catch((error: unknown) => {
              logger.warn({ event: 'mark_read_failed', whatsappMessageId: message.messageId, err: error });
            });
            const profileName = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name;
            const customerId = await this.customers.resolveCustomer(message.from, profileName);
            logger.info({
              event: 'message_received',
              correlationId,
              whatsappMessageId: message.messageId,
              customerId,
              phoneMasked: maskPhone(message.from),
              messageType: message.type,
            });
            await this.flow.handle(message, customerId);
          });
          await this.store.completeEvent(message.messageId);
        } catch (error) {
          await this.store.releaseEvent(message.messageId);
          recordMetric(WHATSAPP_METRIC.WEBHOOK_FAILED);
          throw error;
        }
      }
    });
  }
}
