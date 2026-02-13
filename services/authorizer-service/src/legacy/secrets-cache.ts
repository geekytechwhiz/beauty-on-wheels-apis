/**
 * In-memory cache for Secrets Manager (e.g. USER_POOL_ID).
 * Survives Lambda warm executions; avoids calling Secrets Manager on every request.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

let cachedSecrets: { [key: string]: string } | null = null;
let cachedSecretName: string | null = null;

export interface LegacySecrets {
  USER_POOL_ID: string;
  [key: string]: string;
}

/**
 * Returns parsed secrets (e.g. { USER_POOL_ID }) from Secrets Manager. Cached by secret name.
 */
export async function getLegacySecrets(secretName: string): Promise<LegacySecrets> {
  if (cachedSecrets && cachedSecretName === secretName) {
    return cachedSecrets as LegacySecrets;
  }
  const client = new SecretsManagerClient({
    region: process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const data = await client.send(command);
  const raw = 'SecretString' in data ? data.SecretString : null;
  if (raw == null) {
    const buff =
      data.SecretBinary != null
        ? Buffer.from(data.SecretBinary as Uint8Array, 'base64')
        : null;
    const str = buff != null ? buff.toString('ascii') : '{}';
    const parsed = JSON.parse(str) as Record<string, string>;
    cachedSecrets = parsed;
  } else {
    const parsed = JSON.parse(raw) as Record<string, string>;
    cachedSecrets = parsed;
  }
  cachedSecretName = secretName;
  return cachedSecrets as LegacySecrets;
}
