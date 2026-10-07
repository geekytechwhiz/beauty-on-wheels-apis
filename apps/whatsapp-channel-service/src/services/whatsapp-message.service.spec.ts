import { StructuredLogger } from '@api-hub/observability';
import { MetaWhatsAppProvider, MetaClientConfig } from '../providers/meta-whatsapp.provider';
import { handleSendMessageRequest } from './message-http';
import { WhatsAppMessageService } from './whatsapp-message.service';

const ACCESS_TOKEN = 'test-access-token-value';
const PHONE_NUMBER_ID = '1431657753354506';
const RECIPIENT = '919876543210';

function metaConfig(overrides: Partial<MetaClientConfig> = {}): MetaClientConfig {
  return {
    apiVersion: 'v21.0',
    phoneNumberId: PHONE_NUMBER_ID,
    businessAccountId: 'waba-1',
    accessToken: ACCESS_TOKEN,
    verifyToken: 'verify',
    timeoutMs: 1000,
    ...overrides,
  };
}

function graphResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function harness(fetchImpl: jest.Mock, config: MetaClientConfig = metaConfig()) {
  const service = new WhatsAppMessageService(new MetaWhatsAppProvider(config, fetchImpl as unknown as typeof fetch));
  return {
    postMessage(body: unknown) {
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
      return handleSendMessageRequest({
        method: 'POST',
        path: '/dev/whatsapp/messages',
        rawBody,
        headers: { 'x-correlation-id': 'corr-test' },
        query: {},
      }, async () => service);
    },
  };
}

describe('POST /whatsapp/messages', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends a text message and returns the Meta message id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(graphResponse(200, {
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.abc' }],
    }));
    const response = await harness(fetchImpl).postMessage({
      to: `+${RECIPIENT}`,
      message: '  Hello from Car Wash WhatsApp!  ',
    });
    const payload = JSON.parse(response.body) as {
      success: boolean;
      data: { messageId: string; to: string };
    };

    expect(response.statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ messageId: 'wamid.abc', to: RECIPIENT });

    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`);
    expect(init.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: RECIPIENT,
      type: 'text',
      text: { preview_url: false, body: 'Hello from Car Wash WhatsApp!' },
    });
  });

  it('rejects a missing recipient', async () => {
    const fetchImpl = jest.fn();
    const response = await harness(fetchImpl).postMessage({ message: 'Hello' });
    const payload = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(response.statusCode).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toBe('Recipient phone number is required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a missing message', async () => {
    const fetchImpl = jest.fn();
    const response = await harness(fetchImpl).postMessage({ to: RECIPIENT, message: '   ' });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toBe('Message text is required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone number', async () => {
    const fetchImpl = jest.fn();
    const response = await harness(fetchImpl).postMessage({ to: '12345', message: 'Hello' });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toBe('Recipient must be a WhatsApp phone number in E.164 format');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails when the access token is missing and does not call Meta', async () => {
    const fetchImpl = jest.fn();
    const response = await harness(fetchImpl, metaConfig({ accessToken: '' })).postMessage({
      to: RECIPIENT,
      message: 'Hello',
    });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(500);
    expect(payload.error.code).toBe('WHATSAPP_CONFIG_MISSING');
    expect(payload.error.message).toBe('WhatsApp access token is not configured');
    expect(JSON.stringify(payload)).not.toContain('Bearer');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails when the phone number id is missing and does not call Meta', async () => {
    const fetchImpl = jest.fn();
    const response = await harness(fetchImpl, metaConfig({ phoneNumberId: '' })).postMessage({
      to: RECIPIENT,
      message: 'Hello',
    });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(500);
    expect(payload.error.code).toBe('WHATSAPP_CONFIG_MISSING');
    expect(payload.error.message).toBe('WhatsApp phone number id is not configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails when the API version is missing and does not call Meta', async () => {
    const fetchImpl = jest.fn();
    const response = await harness(fetchImpl, metaConfig({ apiVersion: ' ' })).postMessage({
      to: RECIPIENT,
      message: 'Hello',
    });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(500);
    expect(payload.error.code).toBe('WHATSAPP_CONFIG_MISSING');
    expect(payload.error.message).toBe('WhatsApp API version is not configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('normalizes a Meta 400 response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(graphResponse(400, {
      error: { message: `Invalid parameter ${ACCESS_TOKEN}`, type: 'OAuthException', code: 100 },
    }));
    const response = await harness(fetchImpl).postMessage({ to: RECIPIENT, message: 'Hello' });
    const payload = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(response.statusCode).toBe(502);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatchObject({
      code: 'WHATSAPP_SEND_FAILED',
      message: 'Failed to send WhatsApp message',
    });
    expect(JSON.stringify(payload)).not.toContain(ACCESS_TOKEN);
  });

  it.each([401, 403])('normalizes a Meta %s response', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(graphResponse(status, {
      error: { message: `bad ${ACCESS_TOKEN}`, type: 'OAuthException', code: 190 },
    }));
    const response = await harness(fetchImpl).postMessage({ to: RECIPIENT, message: 'Hello' });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(status);
    expect(payload.error.code).toBe('WHATSAPP_AUTH_FAILED');
    expect(payload.error.message).toBe('Failed to send WhatsApp message');
    expect(JSON.stringify(payload)).not.toContain(ACCESS_TOKEN);
  });

  it('normalizes a Meta timeout', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const response = await harness(fetchImpl).postMessage({ to: RECIPIENT, message: 'Hello' });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(504);
    expect(payload.error.code).toBe('WHATSAPP_SEND_FAILED');
    expect(payload.error.message).toBe('Failed to send WhatsApp message');
  });

  it('normalizes a Meta network failure', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNRESET'), { name: 'TypeError' }));
    const response = await harness(fetchImpl).postMessage({ to: RECIPIENT, message: 'Hello' });
    const payload = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(response.statusCode).toBe(502);
    expect(payload.error.code).toBe('WHATSAPP_SEND_FAILED');
    expect(payload.error.message).toBe('Failed to send WhatsApp message');
  });

  it('does not write the access token or authorization header to logs', async () => {
    const logged: unknown[] = [];
    jest.spyOn(StructuredLogger.prototype, 'info').mockImplementation((entry) => {
      logged.push(entry);
    });
    jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation((entry) => {
      logged.push(entry);
    });
    jest.spyOn(StructuredLogger.prototype, 'warn').mockImplementation((entry) => {
      logged.push(entry);
    });

    const fetchImpl = jest.fn().mockResolvedValue(graphResponse(401, {
      error: { message: `rejected ${ACCESS_TOKEN}`, type: 'OAuthException', code: 190 },
    }));
    await harness(fetchImpl).postMessage({ to: RECIPIENT, message: 'Hello from Car Wash WhatsApp!' });

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain(RECIPIENT);
    expect(serialized).not.toContain('Hello from Car Wash WhatsApp!');
    expect(serialized).toContain('whatsapp_send_request_received');
    expect(serialized).toContain('whatsapp_send_attempted');
    expect(serialized).toContain('meta_api_failed');
    expect(serialized).toContain('whatsapp_send_failed');
  });
});
