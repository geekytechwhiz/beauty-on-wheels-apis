import { createHmac } from 'node:crypto';
import { handleHttpRequest, WebhookRuntime } from './webhook-http';

function runtime(overrides: Partial<WebhookRuntime> = {}): WebhookRuntime {
  return {
    verifyWebhook: (mode, token, challenge) => (mode === 'subscribe' && token === 'verify' && challenge ? challenge : null),
    verifySignature: (rawBody, signature) => {
      if (!signature?.startsWith('sha256=')) return false;
      const expected = createHmac('sha256', 'secret').update(rawBody).digest('hex');
      return signature.slice(7) === expected;
    },
    processInline: true,
    processWebhook: jest.fn(),
    enqueue: jest.fn(),
    ...overrides,
  };
}

describe('handleHttpRequest', () => {
  it('returns the Meta challenge as plain text', async () => {
    const response = await handleHttpRequest({
      method: 'GET',
      path: '/webhooks/whatsapp',
      rawBody: '',
      headers: {},
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify', 'hub.challenge': '12345' },
    }, runtime());
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('12345');
    expect(response.headers['Content-Type']).toBe('text/plain');
  });

  it('rejects a bad verify token', async () => {
    const response = await handleHttpRequest({
      method: 'GET',
      path: '/webhooks/whatsapp',
      rawBody: '',
      headers: {},
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '12345' },
    }, runtime());
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('rejects an invalid signature', async () => {
    const response = await handleHttpRequest({
      method: 'POST',
      path: '/webhooks/whatsapp',
      rawBody: '{}',
      headers: { 'x-hub-signature-256': 'sha256=00' },
      query: {},
    }, runtime());
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('acknowledges a signed webhook and processes it inline', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const signature = createHmac('sha256', 'secret').update(body).digest('hex');
    const deps = runtime();
    const response = await handleHttpRequest({
      method: 'POST',
      path: '/webhooks/whatsapp',
      rawBody: body,
      headers: { 'X-Hub-Signature-256': `sha256=${signature}` },
      query: {},
    }, deps);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.received).toBe(true);
    expect(deps.processWebhook).toHaveBeenCalledTimes(1);
  });

  it('enqueues instead of processing when inline mode is off', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account' });
    const signature = createHmac('sha256', 'secret').update(body).digest('hex');
    const deps = runtime({ processInline: false });
    const response = await handleHttpRequest({
      method: 'POST',
      path: '/webhooks/whatsapp',
      rawBody: body,
      headers: { 'x-hub-signature-256': `sha256=${signature}` },
      query: {},
    }, deps);
    expect(response.statusCode).toBe(200);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.processWebhook).not.toHaveBeenCalled();
  });

  it('returns health and a validation error for malformed JSON', async () => {
    const health = await handleHttpRequest({ method: 'GET', path: '/health', rawBody: '', headers: {}, query: {} }, runtime());
    expect(health.statusCode).toBe(200);

    const body = '{';
    const signature = createHmac('sha256', 'secret').update(body).digest('hex');
    const response = await handleHttpRequest({
      method: 'POST',
      path: '/webhooks/whatsapp',
      rawBody: body,
      headers: { 'x-hub-signature-256': `sha256=${signature}` },
      query: {},
    }, runtime());
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
  });
});
