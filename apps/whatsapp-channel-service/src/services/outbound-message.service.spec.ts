import { InMemoryConversationStore } from '../repositories/conversation.repository';
import { MetaWhatsAppProvider } from '../providers/meta-whatsapp.provider';
import { TEMPLATE_KEY } from '../templates/registry';
import { OutboundMessageService } from './outbound-message.service';

describe('OutboundMessageService', () => {
  const meta = { template: jest.fn() } as unknown as MetaWhatsAppProvider;
  const store = new InMemoryConversationStore();
  const service = new OutboundMessageService(meta, store);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails safely when a template variable is missing', async () => {
    await expect(service.sendTemplate('9198', TEMPLATE_KEY.BOOKING_CONFIRMATION, { bookingId: 'b1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(meta.template).not.toHaveBeenCalled();
  });

  it('does not send marketing templates without consent', async () => {
    await expect(service.sendTemplate('9198', TEMPLATE_KEY.MARKETING_OFFER, { offerName: 'Monsoon' })).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
    });
    expect(meta.template).not.toHaveBeenCalled();
  });

  it('sends a marketing template after opt-in', async () => {
    await store.setMarketingConsent('9198', true);
    await service.sendTemplate('9198', TEMPLATE_KEY.MARKETING_OFFER, { offerName: 'Monsoon' });
    expect(meta.template).toHaveBeenCalledWith('9198', 'marketing_offer_v1', 'en', [{ type: 'text', text: 'Monsoon' }]);
  });
});
