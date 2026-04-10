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
