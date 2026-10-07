import { APIGatewayProxyEvent } from 'aws-lambda';
import { getWebhookRuntime } from '../composition';
import { WebhookRuntime } from '../services/webhook-http';
import { handler } from './webhook';

jest.mock('../composition', () => ({
  getWebhookRuntime: jest.fn(),
}));

const getRuntime = jest.mocked(getWebhookRuntime);

function apiEvent(
  path: string,
  method = 'GET',
  query: Record<string, string> | null = null,
  body: string | null = null,
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    headers: {},
    queryStringParameters: query,
    body,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: { requestId: 'req-health' } as APIGatewayProxyEvent['requestContext'],
    resource: path,
  };
}

describe('webhook handler', () => {
  beforeEach(() => {
    getRuntime.mockReset();
  });

  it('returns liveness when secrets and downstream dependencies are unavailable', async () => {
    getRuntime.mockRejectedValue(new Error('Secrets Manager unavailable'));
    const response = await handler(apiEvent('/health'));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data).toEqual({
      status: 'ok',
      service: 'whatsapp-channel-service',
    });
    expect(getRuntime).not.toHaveBeenCalled();

    const staged = await handler(apiEvent('/dev/health'));
    expect(staged.statusCode).toBe(200);
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('verifies a webhook challenge without signature or downstream calls', async () => {
    const runtime: WebhookRuntime = {
      verifyWebhook: (mode, token, challenge) => (mode === 'subscribe' && token === 'verify-token' && challenge ? challenge : null),
      verifySignature: () => { throw new Error('app secret unavailable'); },
      processInline: false,
      processWebhook: () => Promise.reject(new Error('catalog unavailable')),
      enqueue: () => Promise.reject(new Error('booking unavailable')),
    };
    getRuntime.mockResolvedValue(runtime);

    const accepted = await handler(apiEvent('/webhooks/whatsapp', 'GET', {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-token',
      'hub.challenge': '555',
    }));
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).toBe('555');

    const rejected = await handler(apiEvent('/webhooks/whatsapp', 'GET', {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': '555',
    }));
    expect(rejected.statusCode).toBe(403);
  });
});
