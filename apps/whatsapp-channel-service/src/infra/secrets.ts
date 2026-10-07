import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createChildLogger, createLogger } from '@api-hub/observability';
import { ChannelConfig } from '../config/env';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'secrets',
});

let client: SecretsManagerClient | undefined;
const cache = new Map<string, string>();

function secretsClient(region: string): SecretsManagerClient {
  if (!client) client = new SecretsManagerClient({ region });
  return client;
}

export async function readSecret(region: string, secretId: string): Promise<string> {
  const cached = cache.get(secretId);
  if (cached) return cached;
  // Not DynamoDB. The shared lint rule treats every client.send() call as a table access.
  // eslint-disable-next-line mvrx/no-direct-dynamodb
  const response = await secretsClient(region).send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = response.SecretString;
  if (!value) {
    logger.error({ event: 'secret_empty', secretId });
    throw new Error(`Secret ${secretId} has no string value`);
  }
  cache.set(secretId, value);
  return value;
}

export interface MetaCredentials {
  accessToken: string;
  appSecret: string;
}

export async function loadMetaCredentials(config: ChannelConfig): Promise<MetaCredentials> {
  const accessToken = config.accessToken
    ? config.accessToken
    : await readSecret(config.region, config.accessTokenSecretId);
  const appSecret = config.appSecret ? config.appSecret : await readSecret(config.region, config.appSecretId);
  return { accessToken, appSecret };
}

export async function loadServiceAuthToken(config: ChannelConfig): Promise<string | undefined> {
  if (config.serviceAuthToken) return config.serviceAuthToken;
  if (!config.serviceAuthTokenSecretId) return undefined;
  return readSecret(config.region, config.serviceAuthTokenSecretId);
}

export function resetSecretsForTests(): void {
  cache.clear();
  client = undefined;
}
