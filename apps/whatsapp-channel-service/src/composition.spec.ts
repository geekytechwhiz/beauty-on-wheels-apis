/* eslint-disable mvrx/no-process-env-outside-config -- getWebhookRuntime reads loadConfig() from the Lambda environment */
import { createHmac } from 'node:crypto';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { StructuredLogger } from '@api-hub/observability';
import { resetConfigForTests } from './config/env';
import { resetSecretsForTests } from './infra/secrets';
import { getWebhookRuntime, resetRuntimeForTests } from './composition';

const SECRET_NAME = 'apdev-beauty-on-wheels/whatsapp';
const ACCESS_TOKEN = 'test-access-token-value';
const APP_SECRET = 'test-app-secret-value';
const PHONE_NUMBER_ID = '1431657753354506';
const BUSINESS_ACCOUNT_ID = '1390181996618679';

const ENV_KEYS = [
  'WHATSAPP_SECRET_NAME',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_API_VERSION',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_CONVERSATION_TABLE',
  'INBOUND_QUEUE_URL',
  'DEFAULT_AWS_REGION',
  'WHATSAPP_CUSTOMER_LINKS',
] as const;

describe('webhook runtime credential loading', () => {
  const previous = new Map<string, string | undefined>();
  const logged: unknown[] = [];

  beforeEach(() => {
    for (const key of ENV_KEYS) previous.set(key, process.env[key]);
    process.env.WHATSAPP_SECRET_NAME = SECRET_NAME;
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-token';
    process.env.WHATSAPP_API_VERSION = 'v25.0';
    process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = BUSINESS_ACCOUNT_ID;
    process.env.DEFAULT_AWS_REGION = 'ap-south-1';
    process.env.WHATSAPP_CUSTOMER_LINKS = '';
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_CONVERSATION_TABLE;
    delete process.env.INBOUND_QUEUE_URL;
    resetConfigForTests();
    resetRuntimeForTests();
    resetSecretsForTests();
    logged.length = 0;
    jest.spyOn(StructuredLogger.prototype, 'info').mockImplementation((entry) => {
      logged.push(entry);
    });
    jest.spyOn(StructuredLogger.prototype, 'warn').mockImplementation((entry) => {
      logged.push(entry);
    });
    jest.spyOn(StructuredLogger.prototype, 'error').mockImplementation((entry) => {
      logged.push(entry);
    });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
    resetSecretsForTests();
    resetRuntimeForTests();
    resetConfigForTests();
  });

  function secret(appSecret?: string) {
    const send = jest.fn().mockResolvedValue({
      SecretString: JSON.stringify({
        WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
        WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
        ...(appSecret ? { WHATSAPP_APP_SECRET: appSecret } : {}),
      }),
    });
    resetSecretsForTests({ send } as unknown as SecretsManagerClient);
    resetRuntimeForTests();
    resetConfigForTests();
    return send;
  }

  it('verifies the webhook token without reading Secrets Manager', async () => {
    const send = secret(APP_SECRET);
    const runtime = await getWebhookRuntime();

    expect(runtime.verifyWebhook('subscribe', 'verify-token', 'challenge-1')).toBe('challenge-1');
    expect(runtime.verifyWebhook('subscribe', 'wrong-token', 'challenge-1')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature and accepts a valid one', async () => {
    const send = secret(APP_SECRET);
    const runtime = await getWebhookRuntime();
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const signature = createHmac('sha256', APP_SECRET).update(body).digest('hex');

    await expect(runtime.verifySignature(body, 'sha256=00')).resolves.toBe(false);
    await expect(runtime.verifySignature(body, `sha256=${signature}`)).resolves.toBe(true);
    expect(send.mock.calls[0][0].input.SecretId).toBe(SECRET_NAME);
    expect(JSON.stringify(logged)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(logged)).not.toContain(APP_SECRET);
    expect(JSON.stringify(logged)).not.toContain('Bearer');
  });

  it('rejects webhook posts when the app secret is not in the secret', async () => {
    secret();
    const runtime = await getWebhookRuntime();
    const body = '{}';
    const signature = createHmac('sha256', APP_SECRET).update(body).digest('hex');

    await expect(runtime.verifySignature(body, `sha256=${signature}`)).resolves.toBe(false);
    expect(logged).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'whatsapp_app_secret_missing' }),
    ]));
    expect(JSON.stringify(logged)).not.toContain(ACCESS_TOKEN);
  });
});
