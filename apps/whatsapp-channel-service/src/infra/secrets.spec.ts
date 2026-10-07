import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { StructuredLogger } from '@api-hub/observability';
import { loadConfig, resetConfigForTests } from '../config/env';
import { loadWhatsAppCredentials, resetSecretsForTests } from './secrets';

const SECRET_NAME = 'apdev-beauty-on-wheels/whatsapp';
const ACCESS_TOKEN = 'test-access-token-value';
const PHONE_NUMBER_ID = '1431657753354506';
const BUSINESS_ACCOUNT_ID = '1390181996618679';
const APP_SECRET = 'test-app-secret-value';

const logged: unknown[] = [];

function config(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    WHATSAPP_SECRET_NAME: SECRET_NAME,
    DEFAULT_AWS_REGION: 'ap-south-1',
    ...env,
  });
}

function secretJson(overrides: Record<string, string> = {}): string {
  return JSON.stringify({
    WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
    ...overrides,
  });
}

function installClient(secretString: string | undefined) {
  const send = jest.fn().mockResolvedValue({ SecretString: secretString });
  resetSecretsForTests({ send } as unknown as SecretsManagerClient);
  return send;
}

function expectNoSecretValues(...values: string[]) {
  const text = JSON.stringify(logged);
  for (const value of values) expect(text).not.toContain(value);
  expect(text).not.toContain('Bearer');
}

describe('loadWhatsAppCredentials', () => {
  beforeEach(() => {
    logged.length = 0;
    resetConfigForTests();
    resetSecretsForTests();
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
    jest.restoreAllMocks();
    resetSecretsForTests();
    resetConfigForTests();
  });

  it('loads the whatsapp secret, parses JSON, and returns credentials', async () => {
    const send = installClient(secretJson());
    const credentials = await loadWhatsAppCredentials(config({ STAGE: 'dev' }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input.SecretId).toBe(SECRET_NAME);
    expect(send.mock.calls[0][0].input.SecretId).not.toContain('nvdev-bw');
    expect(credentials).toEqual({
      accessToken: ACCESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      businessAccountId: BUSINESS_ACCOUNT_ID,
      appSecret: undefined,
    });
    expect(credentials.phoneNumberId).not.toBe(credentials.businessAccountId);
    expect(logged).toEqual([{ event: 'whatsapp_secret_load', secretName: SECRET_NAME }]);
    expectNoSecretValues(ACCESS_TOKEN);
  });

  it('returns the app secret when the JSON secret includes it', async () => {
    installClient(secretJson({ WHATSAPP_APP_SECRET: APP_SECRET }));
    const credentials = await loadWhatsAppCredentials(config());
    expect(credentials.appSecret).toBe(APP_SECRET);
    expectNoSecretValues(ACCESS_TOKEN, APP_SECRET);
  });

  it('keeps configured phone and business ids distinct from the secret values', async () => {
    installClient(secretJson({
      WHATSAPP_PHONE_NUMBER_ID: '111',
      WHATSAPP_BUSINESS_ACCOUNT_ID: '222',
    }));
    const credentials = await loadWhatsAppCredentials(config({
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
    }));
    expect(credentials.phoneNumberId).toBe(PHONE_NUMBER_ID);
    expect(credentials.businessAccountId).toBe(BUSINESS_ACCOUNT_ID);
    expectNoSecretValues(ACCESS_TOKEN);
  });

  it('caches a successful read for the secret name', async () => {
    const send = installClient(secretJson());
    await loadWhatsAppCredentials(config());
    await loadWhatsAppCredentials(config());
    expect(send).toHaveBeenCalledTimes(1);
    expectNoSecretValues(ACCESS_TOKEN);
  });

  it('uses a local access token override without calling Secrets Manager', async () => {
    const send = installClient(secretJson());
    const credentials = await loadWhatsAppCredentials(config({
      WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
    }));
    expect(send).not.toHaveBeenCalled();
    expect(credentials.accessToken).toBe(ACCESS_TOKEN);
    expect(credentials.appSecret).toBe(APP_SECRET);
    expectNoSecretValues(ACCESS_TOKEN, APP_SECRET);
  });

  it('requires WHATSAPP_SECRET_NAME before calling Secrets Manager', async () => {
    const send = installClient(secretJson());
    await expect(loadWhatsAppCredentials(config({ WHATSAPP_SECRET_NAME: ' ' }))).rejects.toThrow(
      'WHATSAPP_SECRET_NAME is required',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('handles a missing secret without logging secret values', async () => {
    const error = new Error('not found');
    error.name = 'ResourceNotFoundException';
    const send = installClient(secretJson());
    send.mockRejectedValue(error);

    await expect(loadWhatsAppCredentials(config())).rejects.toBe(error);
    expect(logged).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'whatsapp_secret_read_failed',
        secretName: SECRET_NAME,
        errorName: 'ResourceNotFoundException',
      }),
    ]));
    expectNoSecretValues(ACCESS_TOKEN);
  });

  it.each(['', undefined])('handles an empty SecretString (%p)', async (secretString) => {
    installClient(secretString);
    await expect(loadWhatsAppCredentials(config())).rejects.toThrow(
      `Secret ${SECRET_NAME} has no string value`,
    );
    expect(logged).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'secret_empty', secretName: SECRET_NAME }),
    ]));
    expect(JSON.stringify(logged)).not.toContain('whatsapp_secret_read_failed');
  });

  it('handles invalid JSON', async () => {
    installClient('{');
    await expect(loadWhatsAppCredentials(config())).rejects.toThrow(
      `WhatsApp secret ${SECRET_NAME} is not valid JSON`,
    );
    expectNoSecretValues(ACCESS_TOKEN);
  });

  it('handles a missing required field without logging other secret values', async () => {
    installClient(JSON.stringify({
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
      WHATSAPP_APP_SECRET: APP_SECRET,
    }));
    await expect(loadWhatsAppCredentials(config())).rejects.toThrow(
      `WhatsApp secret ${SECRET_NAME} is missing required fields: WHATSAPP_ACCESS_TOKEN`,
    );
    expectNoSecretValues(APP_SECRET);
  });

  it('defaults the Graph API version to v25.0 and reads the secret name from configuration', () => {
    expect(loadConfig({}).apiVersion).toBe('v25.0');
    expect(loadConfig({ WHATSAPP_SECRET_NAME: SECRET_NAME, STAGE: 'prod' }).whatsappSecretName).toBe(SECRET_NAME);
  });
});
