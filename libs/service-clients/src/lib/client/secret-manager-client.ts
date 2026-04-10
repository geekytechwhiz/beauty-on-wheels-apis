import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const region = process.env.AWS_REGION || process.env.REGION || 'us-east-1';
const secretManagerBaseName = process.env.SECRET_MANAGER_NAME?.trim();

const client = new SecretsManagerClient({ region });

const resolveSecretId = (secretId: string): string => {
  if (!secretManagerBaseName) return secretId;
  if (secretId.startsWith(secretManagerBaseName)) return secretId;
  return `${secretManagerBaseName}/${secretId}`;
};

export const upsertSecretValue = async (secretId: string, secretValue: string): Promise<void> => {
  const resolvedSecretId = resolveSecretId(secretId);
  try {
    await client.send(
      new CreateSecretCommand({
        Name: resolvedSecretId,
        SecretString: secretValue,
      }),
    );
  } catch (error: unknown) {
    const code = (error as { name?: string })?.name;
    if (code !== 'ResourceExistsException') {
      throw error;
    }
    await client.send(
      new PutSecretValueCommand({
        SecretId: resolvedSecretId,
        SecretString: secretValue,
      }),
    );
  }
};

export const getSecretValue = async (secretId: string): Promise<string | null> => {
  const resolvedSecretId = resolveSecretId(secretId);
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: resolvedSecretId,
    }),
  );
  return response.SecretString ?? null;
};

const parseSecretObject = (value: string | null): Record<string, string> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
};

export const upsertSecretKeyValue = async (key: string, value: string): Promise<void> => {
  if (!secretManagerBaseName) {
    throw new Error('SECRET_MANAGER_NAME is required to upsert API keys');
  }

  let existingRaw: string | null = null;
  try {
    existingRaw = await getSecretValue(secretManagerBaseName);
  } catch (error: unknown) {
    const code = (error as { name?: string })?.name;
    if (code !== 'ResourceNotFoundException') {
      throw error;
    }
  }

  const existing = parseSecretObject(existingRaw);
  existing[key] = value;
  const nextSecretString = JSON.stringify(existing);

  if (existingRaw === null) {
    await client.send(
      new CreateSecretCommand({
        Name: secretManagerBaseName,
        SecretString: nextSecretString,
      }),
    );
    return;
  }

  await client.send(
    new PutSecretValueCommand({
      SecretId: secretManagerBaseName,
      SecretString: nextSecretString,
    }),
  );
};

export const getSecretKeyValue = async (key: string): Promise<string | null> => {
  if (!secretManagerBaseName) {
    return null;
  }
  const raw = await getSecretValue(secretManagerBaseName);
  const data = parseSecretObject(raw);
  return data[key] ?? null;
};
