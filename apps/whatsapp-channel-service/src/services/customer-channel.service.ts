import { createChildLogger, createLogger } from '@api-hub/observability';
import { maskPhone } from '../errors/channel-error';
import { ConversationStore } from '../repositories/conversation.repository';
import { UserClient } from '../providers/domain.providers';
import { CHANNEL } from '../types/domain';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'customer-channel',
});

export class CustomerChannelService {
  constructor(
    private readonly store: ConversationStore,
    private readonly users: UserClient,
    private readonly links: Record<string, string>,
  ) {}

  async resolveCustomer(channelUserId: string, profileName?: string): Promise<string | undefined> {
    const existing = await this.store.getIdentity(channelUserId);
    if (existing?.customerId) return existing.customerId;

    const linked = this.links[channelUserId.replace(/\D/g, '')];
    const now = new Date().toISOString();
    await this.store.saveIdentity({
      channel: CHANNEL.WHATSAPP,
      channelUserId,
      phoneNumber: channelUserId,
      customerId: linked,
      profileName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (!linked) {
      logger.info({ event: 'customer_unlinked', phoneMasked: maskPhone(channelUserId) });
    }
    return linked;
  }

  async hasMarketingConsent(channelUserId: string): Promise<boolean> {
    return this.store.getMarketingConsent(channelUserId);
  }

  async setMarketingConsent(channelUserId: string, customerId: string | undefined, optedIn: boolean): Promise<void> {
    await this.store.setMarketingConsent(channelUserId, optedIn);
    if (!customerId) return;
    try {
      await this.users.updateMarketingConsent(customerId, optedIn);
    } catch (error) {
      logger.warn({
        event: 'marketing_consent_profile_update_failed',
        customerId,
        code: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
