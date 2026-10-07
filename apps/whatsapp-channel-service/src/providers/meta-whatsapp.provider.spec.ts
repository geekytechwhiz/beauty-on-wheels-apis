import { createHmac } from 'node:crypto';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { CHANNEL_ERROR_CODE } from '../errors/channel-error';

const config = {
  apiVersion: 'v23.0',
  phoneNumberId: 'phone-1',
  businessAccountId: 'waba-1',
  accessToken: 'token',
  appSecret: 'secret',
  verifyToken: 'verify',
  timeoutMs: 1000,
};

describe('MetaWhatsAppProvider', () => {
  const provider = new MetaWhatsAppProvider(config, jest.fn());

  it('verifies the webhook challenge and rejects a bad token', () => {
    expect(provider.verifyWebhook('subscribe', 'verify', 'abc')).toBe('abc');
    expect(provider.verifyWebhook('subscribe', 'wrong', 'abc')).toBeNull();
    expect(provider.verifyWebhook('unsubscribe', 'verify', 'abc')).toBeNull();
  });

  it('verifies the Meta signature and rejects a mismatched digest', () => {
    const raw = '{"hello":"world"}';
    const signature = createHmac('sha256', 'secret').update(raw).digest('hex');
    expect(provider.verifySignature(raw, `sha256=${signature}`)).toBe(true);
    expect(provider.verifySignature(raw, 'sha256=00')).toBe(false);
    expect(provider.verifySignature(raw, undefined)).toBe(false);
  });

  it('parses text, button, list, and unsupported messages', () => {
    const messages = provider.parseMessages({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [
              { id: 'm1', from: '919800000000', type: 'text', text: { body: 'hi' } },
              { id: 'm2', from: '919800000000', type: 'interactive', interactive: { button_reply: { id: 'MAIN_BOOK', title: 'Book Service' } } },
              { id: 'm3', from: '919800000000', type: 'interactive', interactive: { list_reply: { id: 'CAT:cat1', title: 'Wash' } } },
              { id: 'm4', from: '919800000000', type: 'button', button: { payload: 'STOP', text: 'Stop' } },
              { id: 'm5', from: '919800000000', type: 'image' },
            ],
          },
        }],
      }],
    });

    expect(messages.map((message) => message.type)).toEqual(['text', 'interactive', 'interactive', 'button', 'image']);
    expect(messages[0].text).toBe('hi');
    expect(messages[1].interactiveId).toBe('MAIN_BOOK');
    expect(messages[2].interactiveId).toBe('CAT:cat1');
    expect(messages[3].interactiveId).toBe('STOP');
  });

  it('parses delivery status events', () => {
    const statuses = provider.parseStatuses({
      entry: [{ changes: [{ value: { statuses: [{ id: 'm1', status: 'delivered', timestamp: '1', recipient_id: '919800000000' }] } }] }],
    });
    expect(statuses[0]).toMatchObject({ messageId: 'm1', status: 'delivered' });
  });

  it('does not include the access token in Meta API errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'token=secret' });
    const failing = new MetaWhatsAppProvider(config, fetchImpl as unknown as typeof fetch);
    let error: unknown;
    try {
      await failing.text('919800000000', 'hello');
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: CHANNEL_ERROR_CODE.AUTHENTICATION_ERROR });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secret');
    expect(JSON.stringify(error)).not.toContain('Bearer token');
  });
});
