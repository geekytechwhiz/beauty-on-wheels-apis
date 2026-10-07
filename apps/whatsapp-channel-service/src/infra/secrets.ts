import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createChildLogger, createLogger } from '@api-hub/observability';
import { ChannelConfig } from '../config/env';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'secrets',
});

let client: SecretsManagerClient | undefined;
const credentialsCache = new Map<string, WhatsAppCredentials>();

/**
 * JSON shape of the single WhatsApp secret.
 * `WHATSAPP_APP_SECRET` is optional until the Meta app secret is stored in that secret.
 * Webhook signature checks stay fail-closed while it is absent.
 */
export interface WhatsAppSecret {
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID: string;
  WHATSAPP_APP_SECRET?: string;
}

export interface WhatsAppCredentials {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  appSecret?: string;
}

function secretsClient(region: string): SecretsManagerClient {
  if (!client) client = new SecretsManagerClient({ region });
  return client;
}

export async function readSecret(region: string, secretId: string): Promise<string> {
  const secretName = secretId.trim();
  if (!secretName) {
    throw new Error('Secret name is required');
  }

  try {
    // Not DynamoDB. The shared lint rule treats every client.send() call as a table access.
    // eslint-disable-next-line mvrx/no-direct-dynamodb
    const response = await secretsClient(region).send(new GetSecretValueCommand({ SecretId: secretName }));
    const value = response.SecretString;
    if (!value?.trim()) {
      logger.error({ event: 'secret_empty', secretName });
      throw new Error(`Secret ${secretName} has no string value`);
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === `Secret ${secretName} has no string value`) {
      throw error;
    }
    const errorName = error instanceof Error ? error.name : 'Error';
    logger.error({ event: 'whatsapp_secret_read_failed', secretName, errorName });
    throw error;
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parseWhatsAppSecret(raw: string, secretName: string): WhatsAppSecret {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error({ event: 'whatsapp_secret_invalid_json', secretName });
    throw new Error(`WhatsApp secret ${secretName} is not valid JSON`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.error({ event: 'whatsapp_secret_invalid_json', secretName });
    throw new Error(`WhatsApp secret ${secretName} is not a JSON object`);
  }

  const record = parsed as Record<string, unknown>;
  return {
    WHATSAPP_ACCESS_TOKEN: stringField(record, 'WHATSAPP_ACCESS_TOKEN'),
    WHATSAPP_PHONE_NUMBER_ID: stringField(record, 'WHATSAPP_PHONE_NUMBER_ID'),
    WHATSAPP_BUSINESS_ACCOUNT_ID: stringField(record, 'WHATSAPP_BUSINESS_ACCOUNT_ID'),
    WHATSAPP_APP_SECRET: stringField(record, 'WHATSAPP_APP_SECRET') || undefined,
  };
}

function missingFields(credentials: WhatsAppCredentials): string[] {
  const missing: string[] = [];
  if (!credentials.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!credentials.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!credentials.businessAccountId) missing.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
  return missing;
}

function assertCredentials(credentials: WhatsAppCredentials, secretName: string): WhatsAppCredentials {
  const missing = missingFields(credentials);
  if (missing.length === 0) return credentials;
  logger.error({ event: 'whatsapp_secret_invalid', secretName, fields: missing });
  throw new Error(`WhatsApp secret ${secretName} is missing required fields: ${missing.join(', ')}`);
}

export async function loadWhatsAppCredentials(config: ChannelConfig): Promise<WhatsAppCredentials> {
  if (config.accessToken) {
    return assertCredentials({
      accessToken: config.accessToken,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      appSecret: config.appSecret,
    }, config.whatsappSecretName || 'environment');
  }

  const secretName = config.whatsappSecretName.trim();
  if (!secretName) {
    throw new Error('WHATSAPP_SECRET_NAME is required');
  }

  const cached = credentialsCache.get(secretName);
  if (cached) return cached;

  logger.info({ event: 'whatsapp_secret_load', secretName });
  const parsed = parseWhatsAppSecret(await readSecret(config.region, secretName), secretName);
  const credentials = assertCredentials({
    accessToken: parsed.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: config.phoneNumberId || parsed.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: config.businessAccountId || parsed.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appSecret: config.appSecret || parsed.WHATSAPP_APP_SECRET,
  }, secretName);

  credentialsCache.set(secretName, credentials);
  return credentials;
}

export function resetSecretsForTests(nextClient?: SecretsManagerClient): void {
  credentialsCache.clear();
  client = nextClient;
}
