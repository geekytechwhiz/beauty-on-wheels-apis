import { getSecretKeyValue, upsertSecretKeyValue } from '../client/secret-manager-client';

export class SecretManagerService {
  async addApiKey(apiKeyRef: string, apiKey: string): Promise<void> {
    await upsertSecretKeyValue(apiKeyRef, apiKey);
  }

  async fetchApiKey(apiKeyRef: string): Promise<string | null> {
    return getSecretKeyValue(apiKeyRef);
  }
}
