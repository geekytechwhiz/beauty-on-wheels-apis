/**
 * Registry-driven partner auth (G1/A1/A3/A2) and env fallback.
 * Resolves credentials from Secrets Manager via authConfig.credentialsSecretArn.
 * Supports API_KEY, BEARER, OAUTH_CLIENT_CREDENTIALS.
 */

import axios from 'axios';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { PartnerAuthConfig } from '../adapters/partner.adapter';

const region = process.env.REGION || process.env.DEFAULT_REGION || 'us-east-1';
let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({ region });
  }
  return secretsClient;
}

async function getSecretValue(secretArn: string): Promise<string> {
  const client = getSecretsClient();
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await client.send(command);
  const raw = 'SecretString' in response ? response.SecretString : null;
  if (!raw) throw new Error('Empty secret');
  return raw;
}

function parseSecretAsJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** In-memory OAuth token cache: key -> { token, expiresAt }. */
const oauthTokenCache = new Map<string, { token: string; expiresAt: number }>();
const OAUTH_BUFFER_SEC = 60;

async function fetchOAuthToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number }> {
  const { data } = await axios.post<{ access_token?: string; expires_in?: number }>(
    tokenUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    }
  );
  const token = data?.access_token;
  if (!token) throw new Error('OAuth token response missing access_token');
  return { access_token: token, expires_in: data?.expires_in ?? 3600 };
}

/**
 * Returns auth headers from registry authConfig (A1/A3/A2).
 * API_KEY -> X-API-Key; BEARER -> Authorization: Bearer <key>; OAUTH_CLIENT_CREDENTIALS -> fetch token, cache, Bearer.
 */
export async function getAuthHeadersFromRegistry(authConfig: PartnerAuthConfig): Promise<Record<string, string>> {
  const raw = await getSecretValue(authConfig.credentialsSecretArn);
  const parsed = parseSecretAsJson(raw);

  if (authConfig.authType === 'OAUTH_CLIENT_CREDENTIALS') {
    const tokenUrl = authConfig.oauthTokenUrl;
    if (!tokenUrl) throw new Error('oauthTokenUrl required for OAUTH_CLIENT_CREDENTIALS');
    const clientId = (parsed.client_id ?? parsed.clientId) as string | undefined;
    const clientSecret = (parsed.client_secret ?? parsed.clientSecret) as string | undefined;
    if (!clientId || !clientSecret) throw new Error('Secret must contain client_id and client_secret');
    const cacheKey = `${authConfig.credentialsSecretArn}:${tokenUrl}`;
    const cached = oauthTokenCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt > now + OAUTH_BUFFER_SEC) {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cached.token}`,
      };
    }
    const { access_token: token, expires_in: expiresIn } = await fetchOAuthToken(tokenUrl, clientId, clientSecret);
    oauthTokenCache.set(cacheKey, { token, expiresAt: now + expiresIn });
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  const apiKey =
    (typeof parsed.apiKey === 'string' ? parsed.apiKey : null) ??
    (typeof parsed.API_KEY === 'string' ? parsed.API_KEY : null) ??
    raw;

  if (authConfig.authType === 'API_KEY') {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * Env fallback: returns API key from Secrets Manager (env ARN) or env var.
 * Used when partner has no authConfig in registry.
 */
export async function getPartnerApiKey(envKeySecretArn: string, envKeyFallback: string): Promise<string> {
  const secretArn = process.env[envKeySecretArn];
  if (secretArn) {
    try {
      const raw = await getSecretValue(secretArn);
      const parsed = parseSecretAsJson(raw);
      return (typeof parsed.apiKey === 'string' ? parsed.apiKey : null) ??
        (typeof parsed.API_KEY === 'string' ? parsed.API_KEY : null) ??
        raw;
    } catch {
      return '';
    }
  }
  return process.env[envKeyFallback] ?? '';
}
