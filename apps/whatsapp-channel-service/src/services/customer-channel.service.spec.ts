import { InMemoryConversationStore } from '../repositories/conversation.repository';
import { UserClient } from '../providers/domain.providers';
import { CustomerChannelService } from './customer-channel.service';

describe('CustomerChannelService', () => {
  it('links a WhatsApp number from the pilot map and does not scan users', async () => {
    const users: UserClient = { updateMarketingConsent: jest.fn() };
    const store = new InMemoryConversationStore();
    const service = new CustomerChannelService(store, users, { '919800000000': 'customer-1' });

    await expect(service.resolveCustomer('919800000000', 'Ada')).resolves.toBe('customer-1');
    await expect(service.resolveCustomer('919800000000')).resolves.toBe('customer-1');
    expect(users.updateMarketingConsent).not.toHaveBeenCalled();

    await service.setMarketingConsent('919800000000', 'customer-1', false);
    expect(users.updateMarketingConsent).toHaveBeenCalledWith('customer-1', false);
    await expect(service.hasMarketingConsent('919800000000')).resolves.toBe(false);
  });

  it('leaves the customer unresolved when no link exists', async () => {
    const users: UserClient = { updateMarketingConsent: jest.fn() };
    const service = new CustomerChannelService(new InMemoryConversationStore(), users, {});
    await expect(service.resolveCustomer('919800000001')).resolves.toBeUndefined();
  });
});
