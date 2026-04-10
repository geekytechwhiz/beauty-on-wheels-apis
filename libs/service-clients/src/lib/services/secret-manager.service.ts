import { getSecretValue, upsertSecretValue } from '../client/secret-manager-client';

export class SecretManagerService {
  async addApiKey(apiKeyRef: string, apiKey: string): Promise<void> {
    await upsertSecretValue(apiKeyRef, apiKey);
  }

  async fetchApiKey(apiKeyRef: string): Promise<string | null> {
    return getSecretValue(apiKeyRef);
  }
}
