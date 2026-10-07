import { InMemoryConversationStore } from '../repositories/conversation.repository';
import { MetaWhatsAppProvider } from '../providers/meta-whatsapp.provider';
import { ConversationFlow } from '../flows/conversation.flow';
import { CustomerChannelService } from './customer-channel.service';
import { WhatsAppChannelService } from './channel.service';

describe('WhatsAppChannelService idempotency', () => {
  it('acknowledges a duplicate webhook without handling it twice', async () => {
    const store = new InMemoryConversationStore();
    const handles: string[] = [];
    const meta = {
      parseStatuses: () => [],
      parseMessages: () => [{ messageId: 'm1', from: '9198', type: 'text', text: 'hi' }],
      markRead: jest.fn().mockResolvedValue(undefined),
    } as unknown as MetaWhatsAppProvider;
    const flow = { handle: jest.fn(async (message: { messageId: string }) => { handles.push(message.messageId); }) } as unknown as ConversationFlow;
    const customers = { resolveCustomer: jest.fn().mockResolvedValue('customer-1') } as unknown as CustomerChannelService;
    const service = new WhatsAppChannelService(store, meta, flow, customers);
    const payload = { object: 'whatsapp_business_account' };

    await service.processWebhook(payload, 'corr-1');
    await service.processWebhook(payload, 'corr-1');

    expect(handles).toEqual(['m1']);
  });

  it('releases the claim when handling fails so a retry can proceed', async () => {
    const store = new InMemoryConversationStore();
    let attempts = 0;
    const meta = {
      parseStatuses: () => [{ eventId: 'm1:sent:', messageId: 'm1', status: 'sent' }],
      parseMessages: () => [{ messageId: 'm1', from: '9198', type: 'text', text: 'hi' }],
      markRead: jest.fn().mockResolvedValue(undefined),
    } as unknown as MetaWhatsAppProvider;
    const flow = {
      handle: jest.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('downstream timeout');
      }),
    } as unknown as ConversationFlow;
    const customers = { resolveCustomer: jest.fn().mockResolvedValue(undefined) } as unknown as CustomerChannelService;
    const service = new WhatsAppChannelService(store, meta, flow, customers);

    await expect(service.processWebhook({}, 'corr-1')).rejects.toThrow('downstream timeout');
    await service.processWebhook({}, 'corr-2');
    expect(attempts).toBe(2);
  });
});
