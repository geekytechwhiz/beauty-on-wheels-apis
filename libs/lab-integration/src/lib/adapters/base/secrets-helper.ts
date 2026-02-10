/**
 * Helper to resolve partner API credentials from AWS Secrets Manager.
 * Used by BasePartnerAdapter when authConfig.credentialsSecretArn is set.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const region =
  process.env.REGION ?? process.env.DEFAULT_REGION ?? 'us-east-1';
let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({ region });
  }
  return secretsClient;
}

export async function getSecretValue(secretArn: string): Promise<string> {
  const client = getSecretsClient();
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await client.send(command);
  const raw =
    'SecretString' in response ? response.SecretString : null;
  if (!raw) throw new Error('Empty secret');
  return raw;
}

export function parseSecretAsJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
